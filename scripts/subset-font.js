'use strict';

// Subsets a TrueType font to the characters the song PDF needs (public/song-pdf.js):
// Latin, Latin-1, Latin Extended-A (ă â î ș ț, ø å æ…), the comma-below ș ț, the common
// punctuation (dashes, quotes, bullet, ellipsis), € and the music accidentals ♭ ♯.
// Keeps glyf / loca / hmtx / hhea / head / maxp / OS/2 / name and writes a new cmap (format
// 4) and a format-3 post; drops hinting and layout tables. No dependencies.
//
//   node scripts/subset-font.js <in.ttf> <out.ttf>
//
// Used once to produce public/fonts/*.ttf from the Liberation Sans fonts (SIL OFL 1.1, the
// licence sits next to them); rerun only when the character set changes.

const fs = require('fs');

const RANGES = [[0x20, 0x7e], [0xa0, 0x17f], [0x218, 0x21b], [0x2bc, 0x2bc], [0x2010, 0x2027], [0x2039, 0x203a], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x266d, 0x266f]];
const DROP = new Set(['cvt ', 'fpgm', 'prep', 'gasp', 'GDEF', 'GPOS', 'GSUB', 'kern', 'DSIG', 'hdmx', 'LTSH', 'VDMX', 'FFTM', 'meta', 'post', 'cmap', 'loca', 'glyf', 'hmtx', 'hhea', 'head', 'maxp']);

function readTables(buf) {
  const n = buf.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < n; i += 1) {
    const at = 12 + i * 16;
    const tag = buf.toString('latin1', at, at + 4);
    const offset = buf.readUInt32BE(at + 8);
    const length = buf.readUInt32BE(at + 12);
    tables.set(tag, buf.subarray(offset, offset + length));
  }
  return tables;
}

function parseCmap(cmap) {
  const n = cmap.readUInt16BE(2);
  const map = new Map();
  let best = null;
  for (let i = 0; i < n; i += 1) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const encoding = cmap.readUInt16BE(6 + i * 8);
    const offset = cmap.readUInt32BE(8 + i * 8);
    const format = cmap.readUInt16BE(offset);
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) {
      if (!best || format === 12) best = offset;
    }
  }
  if (best === null) throw new Error('no unicode cmap');
  const format = cmap.readUInt16BE(best);
  if (format === 4) {
    const segX2 = cmap.readUInt16BE(best + 6);
    const seg = segX2 / 2;
    const ends = best + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const rangeOffsets = deltas + segX2;
    for (let s = 0; s < seg; s += 1) {
      const end = cmap.readUInt16BE(ends + s * 2);
      const start = cmap.readUInt16BE(starts + s * 2);
      const delta = cmap.readInt16BE(deltas + s * 2);
      const ro = cmap.readUInt16BE(rangeOffsets + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c += 1) {
        let g;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const at = rangeOffsets + s * 2 + ro + (c - start) * 2;
          g = cmap.readUInt16BE(at);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else if (format === 12) {
    const groups = cmap.readUInt32BE(best + 12);
    for (let gI = 0; gI < groups; gI += 1) {
      const at = best + 16 + gI * 12;
      const start = cmap.readUInt32BE(at);
      const end = cmap.readUInt32BE(at + 4);
      const g0 = cmap.readUInt32BE(at + 8);
      for (let c = start; c <= end; c += 1) map.set(c, g0 + (c - start));
    }
  } else throw new Error(`cmap format ${format} not handled`);
  return map;
}

// cmap format 4 from a sorted (code -> gid) map: segments of consecutive codes with one delta.
function buildCmap(map) {
  const codes = [...map.keys()].sort((a, b) => a - b);
  const segs = [];
  for (const c of codes) {
    const g = map.get(c);
    const last = segs[segs.length - 1];
    if (last && c === last.end + 1 && ((g - c) & 0xffff) === last.delta) last.end = c;
    else segs.push({ start: c, end: c, delta: (g - c) & 0xffff });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const n = segs.length;
  const sub = Buffer.alloc(16 + n * 8);
  sub.writeUInt16BE(4, 0);
  sub.writeUInt16BE(sub.length, 2);
  sub.writeUInt16BE(0, 4);
  sub.writeUInt16BE(n * 2, 6);
  const pow = 2 ** Math.floor(Math.log2(n));
  sub.writeUInt16BE(pow * 2, 8);
  sub.writeUInt16BE(Math.log2(pow), 10);
  sub.writeUInt16BE(n * 2 - pow * 2, 12);
  segs.forEach((s, i) => {
    sub.writeUInt16BE(s.end, 14 + i * 2);
    sub.writeUInt16BE(s.start, 16 + n * 2 + i * 2);
    sub.writeUInt16BE(s.delta, 16 + n * 4 + i * 2);
    sub.writeUInt16BE(0, 16 + n * 6 + i * 2);
  });
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0, 0);
  head.writeUInt16BE(1, 2);
  head.writeUInt16BE(3, 4);
  head.writeUInt16BE(1, 6);
  head.writeUInt32BE(12, 8);
  return Buffer.concat([head, sub]);
}

function checksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const word = ((buf[i] || 0) << 24) | ((buf[i + 1] || 0) << 16) | ((buf[i + 2] || 0) << 8) | (buf[i + 3] || 0);
    sum = (sum + (word >>> 0)) % 2 ** 32;
  }
  return sum >>> 0;
}

function subset(input) {
  const tables = readTables(input);
  const head = tables.get('head');
  const longLoca = head.readInt16BE(50) === 1;
  const numGlyphs = tables.get('maxp').readUInt16BE(4);
  const hmtx = tables.get('hmtx');
  const numH = tables.get('hhea').readUInt16BE(34);
  const loca = tables.get('loca');
  const glyf = tables.get('glyf');
  const at = (g) => (longLoca ? loca.readUInt32BE(g * 4) : loca.readUInt16BE(g * 2) * 2);
  const glyphData = (g) => glyf.subarray(at(g), at(g + 1));
  const cmap = parseCmap(tables.get('cmap'));
  const wanted = new Map();
  const missing = [];
  for (const [a, b] of RANGES) for (let c = a; c <= b; c += 1) { if (cmap.has(c)) wanted.set(c, cmap.get(c)); else missing.push(c); }
  // the glyphs: the wanted ones, their composite components, glyph 0 (.notdef)
  const keep = new Set([0]);
  const visit = (g) => {
    if (keep.has(g)) return;
    keep.add(g);
    const d = glyphData(g);
    if (d.length && d.readInt16BE(0) < 0) {
      let p = 10;
      for (;;) {
        const flags = d.readUInt16BE(p);
        visit(d.readUInt16BE(p + 2));
        p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
        if (!(flags & 0x20)) break;
      }
    }
  };
  for (const g of wanted.values()) visit(g);
  const old = [...keep].sort((a, b) => a - b);
  const newId = new Map(old.map((g, i) => [g, i]));
  // glyf + loca (long), components renumbered
  const parts = [];
  const offsets = [0];
  let total = 0;
  for (const g of old) {
    const d = Buffer.from(glyphData(g));
    if (d.length && d.readInt16BE(0) < 0) {
      let p = 10;
      for (;;) {
        const flags = d.readUInt16BE(p);
        d.writeUInt16BE(newId.get(d.readUInt16BE(p + 2)), p + 2);
        p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
        if (!(flags & 0x20)) break;
      }
    }
    const padded = d.length % 4 ? Buffer.concat([d, Buffer.alloc(4 - (d.length % 4))]) : d;
    parts.push(padded);
    total += padded.length;
    offsets.push(total);
  }
  const newGlyf = Buffer.concat(parts);
  const newLoca = Buffer.alloc(offsets.length * 4);
  offsets.forEach((o, i) => newLoca.writeUInt32BE(o, i * 4));
  const newHmtx = Buffer.alloc(old.length * 4);
  old.forEach((g, i) => {
    const adv = hmtx.readUInt16BE(Math.min(g, numH - 1) * 4);
    const lsb = g < numH ? hmtx.readInt16BE(g * 4 + 2) : hmtx.readInt16BE(numH * 4 + (g - numH) * 2);
    newHmtx.writeUInt16BE(adv, i * 4);
    newHmtx.writeInt16BE(lsb, i * 4 + 2);
  });
  const newHhea = Buffer.from(tables.get('hhea'));
  newHhea.writeUInt16BE(old.length, 34);
  const newMaxp = Buffer.from(tables.get('maxp'));
  newMaxp.writeUInt16BE(old.length, 4);
  const newHead = Buffer.from(head);
  newHead.writeUInt32BE(0, 8); // checksumAdjustment, set below
  newHead.writeInt16BE(1, 50);
  const newPost = Buffer.alloc(32);
  tables.get('post').copy(newPost, 0, 0, 32);
  newPost.writeUInt32BE(0x00030000, 0);
  const newCmap = buildCmap(new Map([...wanted].map(([c, g]) => [c, newId.get(g)])));
  const out = new Map([['cmap', newCmap], ['glyf', newGlyf], ['head', newHead], ['hhea', newHhea], ['hmtx', newHmtx], ['loca', newLoca], ['maxp', newMaxp], ['post', newPost]]);
  for (const [tag, data] of tables) if (!DROP.has(tag) && !out.has(tag)) out.set(tag, data);
  const tags = [...out.keys()].sort();
  const n = tags.length;
  const dir = Buffer.alloc(12 + n * 16);
  input.copy(dir, 0, 0, 4);
  dir.writeUInt16BE(n, 4);
  const pow = 2 ** Math.floor(Math.log2(n));
  dir.writeUInt16BE(pow * 16, 6);
  dir.writeUInt16BE(Math.log2(pow), 8);
  dir.writeUInt16BE(n * 16 - pow * 16, 10);
  let offset = dir.length;
  const blobs = [];
  tags.forEach((tag, i) => {
    const data = out.get(tag);
    const padded = data.length % 4 ? Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]) : data;
    dir.write(tag, 12 + i * 16, 4, 'latin1');
    dir.writeUInt32BE(checksum(padded), 16 + i * 16);
    dir.writeUInt32BE(offset, 20 + i * 16);
    dir.writeUInt32BE(data.length, 24 + i * 16);
    blobs.push(padded);
    offset += padded.length;
  });
  const file = Buffer.concat([dir, ...blobs]);
  const headAt = dir.readUInt32BE(20 + tags.indexOf('head') * 16);
  file.writeUInt32BE((0xb1b0afba - checksum(file)) >>> 0, headAt + 8);
  return { file, glyphs: old.length, chars: wanted.size, missing };
}

if (require.main === module) {
  const [, , input, output] = process.argv;
  if (!input || !output) { console.error('usage: node scripts/subset-font.js <in.ttf> <out.ttf>'); process.exit(1); }
  const { file, glyphs, chars, missing } = subset(fs.readFileSync(input));
  fs.writeFileSync(output, file);
  console.log(`${output}: ${glyphs} glyphs for ${chars} characters, ${file.length} bytes${missing.length ? `; missing: ${missing.map((c) => `U+${c.toString(16)}`).join(' ')}` : ''}`);
}

module.exports = { subset, parseCmap, RANGES };
