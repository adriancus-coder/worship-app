'use strict';

// The song as a PDF, made in the browser (no server, works offline and in the installed
// app, where window.print() does nothing on phones): the title, the key, the themes and the
// sections as shown on the page (chords above the lyrics, or the text alone). Liberation
// Sans (public/fonts, a subset: scripts/subset-font.js) is embedded, so ă â î ș ț print
// everywhere. On a phone the file goes to the share sheet (Tipărește / Salvează în Fișiere /
// WhatsApp…); elsewhere it downloads.
//
//   SONG_PDF.preload()            fetches the fonts (once, cached)
//   SONG_PDF.make(doc) -> bytes   doc: { title, subtitle, meta, sections: [{ label, note, lines: [{ chords, lyrics }] | text }] }
//   SONG_PDF.deliver(bytes, name) -> 'shared' | 'cancelled' | 'downloaded'

(function () {
  const FONTS = { R: '/fonts/LiberationSans-Regular.ttf', B: '/fonts/LiberationSans-Bold.ttf' };
  const PAGE = { width: 595.28, height: 841.89, left: 48, right: 48, top: 56, bottom: 52 };
  const SIZE = { title: 22, subtitle: 12, meta: 10.5, label: 9.5, line: 12.5 };
  const LEADING = 1.32;
  let fontsPromise = null;

  // --- the font: unitsPerEm, metrics, char -> glyph, glyph widths ---------------------
  function parseFont(bytes) {
    const dv = new DataView(bytes);
    const tables = {};
    const n = dv.getUint16(4);
    for (let i = 0; i < n; i += 1) {
      const at = 12 + i * 16;
      const tag = String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
      tables[tag] = { offset: dv.getUint32(at + 8), length: dv.getUint32(at + 12) };
    }
    const head = tables.head.offset;
    const unitsPerEm = dv.getUint16(head + 18);
    const bbox = [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)];
    const hhea = tables.hhea.offset;
    const ascent = dv.getInt16(hhea + 4);
    const descent = dv.getInt16(hhea + 6);
    const numH = dv.getUint16(hhea + 34);
    const numGlyphs = dv.getUint16(tables.maxp.offset + 4);
    const os2 = tables['OS/2'];
    const capHeight = os2 && os2.length >= 90 ? dv.getInt16(os2.offset + 88) : Math.round(unitsPerEm * 0.7);
    const widths = [];
    for (let g = 0; g < numGlyphs; g += 1) widths.push(dv.getUint16(tables.hmtx.offset + Math.min(g, numH - 1) * 4));
    // cmap: the (3,1) format 4 subtable
    const cmap = tables.cmap.offset;
    const map = new Map();
    const subtables = dv.getUint16(cmap + 2);
    for (let i = 0; i < subtables; i += 1) {
      const platform = dv.getUint16(cmap + 4 + i * 8);
      const encoding = dv.getUint16(cmap + 6 + i * 8);
      const at = cmap + dv.getUint32(cmap + 8 + i * 8);
      if (!((platform === 3 && encoding === 1) || platform === 0) || dv.getUint16(at) !== 4) continue;
      const segX2 = dv.getUint16(at + 6);
      const ends = at + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s += 1) {
        const end = dv.getUint16(ends + s * 2);
        const start = dv.getUint16(starts + s * 2);
        const delta = dv.getInt16(deltas + s * 2);
        const ro = dv.getUint16(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c += 1) {
          let g;
          if (ro === 0) g = (c + delta) & 0xffff;
          else {
            g = dv.getUint16(ranges + s * 2 + ro + (c - start) * 2);
            if (g) g = (g + delta) & 0xffff;
          }
          if (g) map.set(c, g);
        }
      }
      break;
    }
    return { bytes: new Uint8Array(bytes), unitsPerEm, bbox, ascent, descent, capHeight, widths, map };
  }

  async function preload() {
    if (!fontsPromise) {
      fontsPromise = Promise.all(Object.entries(FONTS).map(async ([key, url]) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`font ${url}: ${res.status}`);
        return [key, parseFont(await res.arrayBuffer())];
      })).then(Object.fromEntries).catch((err) => { fontsPromise = null; throw err; });
    }
    return fontsPromise;
  }

  // --- text measuring and encoding --------------------------------------------------------
  const glyphOf = (font, ch) => font.map.get(ch.codePointAt(0)) || font.map.get(0x3f) || 0;
  const width = (font, text, size) => [...text].reduce((w, ch) => w + font.widths[glyphOf(font, ch)], 0) * size / font.unitsPerEm;
  const hex = (font, text) => [...text].map((ch) => glyphOf(font, ch).toString(16).padStart(4, '0')).join('');
  const num = (v) => (Math.round(v * 100) / 100).toString();

  // words wrapped to maxWidth (a word longer than the line stands alone)
  function wrap(font, text, size, maxWidth) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && width(font, candidate, size) > maxWidth) { lines.push(line); line = word; } else line = candidate;
      }
      lines.push(line);
    }
    return lines;
  }

  // chord x positions over a lyric line: a chord at character i sits where the lyric's
  // first i characters end (spaces past the lyric's end count as spaces)
  function chordRuns(fonts, chords, lyrics, size) {
    const runs = [];
    const re = /\S+/g;
    let m;
    let lastEnd = 0;
    while ((m = re.exec(chords)) !== null) {
      const i = m.index;
      const prefix = lyrics.slice(0, i);
      let x = width(fonts.R, prefix, size);
      if (i > lyrics.length) x += (i - lyrics.length) * width(fonts.R, ' ', size);
      if (x < lastEnd) x = lastEnd;
      const w = width(fonts.B, m[0], size);
      runs.push({ text: m[0], x });
      lastEnd = x + w + width(fonts.R, ' ', size) * 0.6;
    }
    return runs;
  }

  // --- layout: a list of drawing lines, then pages -----------------------------------------
  // doc.sections: [{ label, note, text }] (text only) or [{ label, note, lines: [{ chords, lyrics }] }]
  function layout(fonts, doc) {
    const maxWidth = PAGE.width - PAGE.left - PAGE.right;
    const out = []; // { h, draw: [{ font, size, x, text, gray }], keepNext }
    const push = (h, draw, keepNext = false) => out.push({ h, draw, keepNext });
    const text = (font, size, str, { gray = 0, keepNext = false, x = 0, lead = LEADING } = {}) => {
      for (const line of wrap(fonts[font], str, size, maxWidth - x)) push(size * lead, [{ font, size, x, text: line, gray }], keepNext);
    };
    text('B', SIZE.title, doc.title, { lead: 1.2 });
    if (doc.subtitle) text('R', SIZE.subtitle, doc.subtitle, { gray: 0.1 });
    if (doc.meta) text('R', SIZE.meta, doc.meta, { gray: 0.4 });
    push(SIZE.line * 0.8, []);
    // the widest chord-sheet line decides a smaller size when the page is too narrow
    let size = SIZE.line;
    let widest = 0;
    for (const s of doc.sections) {
      for (const l of s.lines || []) {
        widest = Math.max(widest, width(fonts.R, l.lyrics || '', size), l.chords ? Math.max(...chordRuns(fonts, l.chords, l.lyrics || '', size).map((r) => r.x + width(fonts.B, r.text, size))) : 0);
      }
    }
    if (widest > maxWidth) size = Math.max(8, Math.floor(size * maxWidth / widest * 10) / 10);
    doc.sections.forEach((s, index) => {
      if (index) push(SIZE.line * 0.7, []);
      if (s.label) text('B', SIZE.label, s.label.toUpperCase(), { gray: 0.35, keepNext: true });
      if (s.note) text('R', SIZE.meta, s.note, { gray: 0.4, keepNext: true });
      if (s.lines) {
        s.lines.forEach((l, i) => {
          const draw = [];
          let h = 0;
          if (l.chords) {
            for (const r of chordRuns(fonts, l.chords, l.lyrics || '', size)) draw.push({ font: 'B', size, x: r.x, text: r.text, dy: l.lyrics === null ? 0 : size * LEADING });
            h += size * LEADING;
          }
          if (l.lyrics !== null) { draw.push({ font: 'R', size, x: 0, text: l.lyrics, dy: 0 }); h += size * LEADING; }
          push(h, draw, i === 0 && s.lines.length > 1);
        });
      } else {
        wrap(fonts.R, s.text || '', size, maxWidth).forEach((line, i, all) => push(size * LEADING, [{ font: 'R', size, x: 0, text: line }], i === 0 && all.length > 1));
      }
    });
    // pages: lines flow; a line marked keepNext stays with the next one
    const pages = [[]];
    const bottom = PAGE.height - PAGE.top - PAGE.bottom;
    let y = 0;
    out.forEach((line, i) => {
      const next = line.keepNext ? out[i + 1] : null;
      const need = line.h + (next ? next.h : 0);
      if (y + need > bottom && pages[pages.length - 1].length) { pages.push([]); y = 0; }
      pages[pages.length - 1].push(line);
      y += line.h;
    });
    return pages;
  }

  function pageContent(fonts, lines, pageIndex, doc) {
    const ops = [];
    let y = PAGE.height - PAGE.top;
    if (pageIndex) {
      const head = `${doc.title} · ${pageIndex + 1}`;
      ops.push(`BT /FR ${num(SIZE.meta)} Tf 0.45 g 1 0 0 1 ${num(PAGE.width - PAGE.right - width(fonts.R, head, SIZE.meta))} ${num(PAGE.height - PAGE.top + 18)} Tm <${hex(fonts.R, head)}> Tj ET`);
    }
    for (const line of lines) {
      // the last row's baseline sits a little above the line's bottom (room for descenders);
      // a chord row sits one leading higher (dy)
      const size = Math.max(0, ...line.draw.map((d) => d.size));
      const baseline = y - line.h + size * 0.3;
      for (const d of line.draw) {
        ops.push(`BT /F${d.font} ${num(d.size)} Tf ${num(d.gray || 0)} g 1 0 0 1 ${num(PAGE.left + d.x)} ${num(baseline + (d.dy || 0))} Tm <${hex(fonts[d.font], d.text)}> Tj ET`);
      }
      y -= line.h;
    }
    return ops.join('\n');
  }

  // --- the PDF file ---------------------------------------------------------------------
  const encoder = new TextEncoder();
  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate');
      const writer = cs.writable.getWriter();
      writer.write(bytes);
      writer.close();
      return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    } catch (err) {
      return null;
    }
  }
  const utf16 = (s) => `<FEFF${[...s].map((ch) => { const c = ch.codePointAt(0); return c > 0xffff ? ((0xd800 + ((c - 0x10000) >> 10)).toString(16).padStart(4, '0') + (0xdc00 + ((c - 0x10000) & 0x3ff)).toString(16).padStart(4, '0')) : c.toString(16).padStart(4, '0'); }).join('').toUpperCase()}>`;

  async function make(doc) {
    const fonts = await preload();
    const pages = layout(fonts, doc);
    const objects = []; // index + 1 = object number; each: Uint8Array[] parts
    const add = (parts) => { objects.push(parts); return objects.length; };
    const str = (s) => encoder.encode(s);
    const stream = async (dict, bytes, compress = true) => {
      const packed = compress ? await deflate(bytes) : null;
      const body = packed && packed.length < bytes.length ? packed : bytes;
      return [str(`<< ${dict} /Length ${body.length}${body === packed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`), body, str('\nendstream')];
    };
    const catalog = add(null);
    const pagesObj = add(null);
    const fontRefs = {};
    for (const key of ['R', 'B']) {
      const f = fonts[key];
      const scale = 1000 / f.unitsPerEm;
      const file = add(await stream(`/Length1 ${f.bytes.length}`, f.bytes));
      const descriptor = add([str(`<< /Type /FontDescriptor /FontName /LiberationSans${key === 'B' ? '-Bold' : ''} /Flags ${key === 'B' ? 32 + 262144 : 32} /FontBBox [${f.bbox.map((v) => Math.round(v * scale)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(f.ascent * scale)} /Descent ${Math.round(f.descent * scale)} /CapHeight ${Math.round(f.capHeight * scale)} /StemV ${key === 'B' ? 140 : 80} /FontFile2 ${file} 0 R >>`)]);
      const cid = add([str(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /LiberationSans${key === 'B' ? '-Bold' : ''} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 1000 /W [0 [${f.widths.map((w) => Math.round(w * scale)).join(' ')}]] /CIDToGIDMap /Identity >>`)]);
      const pairs = [...f.map].map(([c, g]) => `<${g.toString(16).padStart(4, '0')}> <${c.toString(16).padStart(4, '0')}>`);
      const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${pairs.length} beginbfchar\n${pairs.join('\n')}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
      const toUnicode = add(await stream('', str(cmap)));
      fontRefs[key] = add([str(`<< /Type /Font /Subtype /Type0 /BaseFont /LiberationSans${key === 'B' ? '-Bold' : ''} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`)]);
    }
    const pageNums = [];
    for (let i = 0; i < pages.length; i += 1) {
      const content = add(await stream('', str(pageContent(fonts, pages[i], i, doc))));
      pageNums.push(add([str(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(PAGE.width)} ${num(PAGE.height)}] /Resources << /Font << /FR ${fontRefs.R} 0 R /FB ${fontRefs.B} 0 R >> >> /Contents ${content} 0 R >>`)]));
    }
    objects[catalog - 1] = [str(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`)];
    objects[pagesObj - 1] = [str(`<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`)];
    const info = add([str(`<< /Title ${utf16(doc.title)} /Producer ${utf16(doc.producer || 'worship-app')} >>`)]);
    // assemble
    const chunks = [str('%PDF-1.4\n%âãÏÓ\n')];
    let offset = chunks[0].length;
    const offsets = [];
    objects.forEach((parts, i) => {
      offsets.push(offset);
      const head = str(`${i + 1} 0 obj\n`);
      const tail = str('\nendobj\n');
      for (const part of [head, ...parts, tail]) { chunks.push(part); offset += part.length; }
    });
    const xref = offset;
    chunks.push(str(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
    return bytes;
  }

  // --- hand it over: the share sheet on a phone or tablet, a download elsewhere ----------
  const mobile = () => /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  async function deliver(bytes, filename, title) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (mobile() && navigator.canShare && typeof File === 'function') {
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title });
          return 'shared';
        } catch (err) {
          if (err && err.name === 'AbortError') return 'cancelled';
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'downloaded';
  }

  const fileName = (title) => `${(title || 'cantare').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'cantare'}.pdf`;

  window.SONG_PDF = { preload, make, deliver, fileName, layout, PAGE };
})();
