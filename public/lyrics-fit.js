'use strict';

// Auto-fit for lyrics on the projector (/screen, the previews) and in the big-lyrics view,
// in this order:
//   (a) the largest size at which NO lyric line wraps and everything fits the safe box;
//   (b) when that size is below a minimum (frame.fitMin, % of the maximum size, 60 by
//       default), lines may wrap: each wrapped line is split into balanced rows of whole
//       words, never with a row of fewer than 3 words (a word moves up, or the size shrinks
//       one more step, until every row has at least 3 words);
//   (c) the song's own line breaks are always kept: a stored line is never joined with the
//       next one.
// The planning part is pure (measure() is given: real text widths in the browser, a stand-in
// in scripts/test-lib.js); fitBox() applies a plan to a DOM box.
//
//   LYRICS_FIT.layout({ lines, measure(text, size) -> px, maxW, maxH, rowHeight(size) -> px,
//                       minSize, maxSize, minPct, minWords })
//     -> { size, rows: [[row, ...] per line], wrapped }
//   LYRICS_FIT.fitBox(box, { lineSelector, maxW, maxH, minSize, maxSize, minPct, lineHeight })

(function (root) {
  const isNode = typeof module === 'object' && module.exports;
  const DEFAULT_MIN_PCT = 60; // of the maximum size: below it, wrapping is allowed
  const MIN_TAIL_WORDS = 3; // a wrapped row never has fewer words
  const STEPS = 14; // binary-search iterations (sizes settle within a fraction of a px)

  // n balanced rows of whole words (the first rows one word longer when it does not divide),
  // or null when a row would have fewer than minWords words. n = 1: the line as it is.
  function splitBalanced(line, n, minWords = MIN_TAIL_WORDS) {
    const text = String(line || '').trim();
    if (n <= 1) return [text];
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < n * minWords) return null;
    const base = Math.floor(words.length / n);
    const extra = words.length % n;
    const rows = [];
    let at = 0;
    for (let i = 0; i < n; i++) {
      const take = base + (i < extra ? 1 : 0);
      rows.push(words.slice(at, at + take).join(' '));
      at += take;
    }
    return rows;
  }

  // The most rows a line can be split into with minWords words each.
  function maxChunks(wordCount, minWords = MIN_TAIL_WORDS) {
    return Math.max(1, Math.floor(wordCount / minWords));
  }

  // The largest size in [minSize, maxSize] for which ok(size) holds (ok is monotonic), or null.
  function largest(ok, minSize, maxSize) {
    if (ok(maxSize)) return maxSize;
    if (!ok(minSize)) return null;
    let lo = minSize;
    let hi = maxSize;
    for (let i = 0; i < STEPS && hi - lo > 0.25; i++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  function layout({ lines, measure, maxW, maxH, rowHeight, minSize, maxSize, minPct = DEFAULT_MIN_PCT, minWords = MIN_TAIL_WORDS }) {
    const texts = (lines || []).map((l) => String(l || ''));
    const single = texts.map((l) => [l]);
    const fitsRows = (rows, size) => rows.reduce((n, r) => n + r.length, 0) * rowHeight(size) <= maxH;
    const noWrapAt = (size) => texts.every((l) => measure(l, size) <= maxW) && fitsRows(single, size);
    const noWrap = largest(noWrapAt, minSize, maxSize);
    if (noWrap !== null && noWrap >= maxSize * (minPct / 100)) return { size: noWrap, rows: single, wrapped: false };

    // Wrapping allowed: at a size, the rows of every line (null when some line cannot be split
    // into rows of >= words that fit, or the rows do not fit the height).
    const plan = (size, words) => {
      const rows = [];
      for (const line of texts) {
        if (measure(line, size) <= maxW) { rows.push([line]); continue; }
        const count = line.trim().split(/\s+/).filter(Boolean).length;
        let found = null;
        for (let n = 2; n <= maxChunks(count, words) && !found; n++) {
          const chunks = splitBalanced(line, n, words);
          if (chunks && chunks.every((c) => measure(c, size) <= maxW)) found = chunks;
        }
        if (!found) return null;
        rows.push(found);
      }
      return fitsRows(rows, size) ? rows : null;
    };
    // The rule first; as a last resort (a very long word, a tiny box) shorter tails, then the
    // no-wrap layout at the minimum size (it may overflow, but nothing is ever cut).
    for (const words of [minWords, 2, 1]) {
      const size = largest((s) => plan(s, words) !== null, minSize, maxSize);
      if (size !== null) return { size: Math.max(size, noWrap || 0), rows: plan(Math.max(size, noWrap || 0), words), wrapped: true };
    }
    return { size: noWrap === null ? minSize : noWrap, rows: single, wrapped: false };
  }

  const LOGIC = { DEFAULT_MIN_PCT, MIN_TAIL_WORDS, splitBalanced, maxChunks, layout };
  if (isNode) {
    module.exports = LOGIC;
    return;
  }

  // --- the DOM part -----------------------------------------------------------------------

  // Fits `box` (font-size set on it): the lines are the nodes matching lineSelector (their
  // original text is kept in data-text); every wrapped line becomes rows of .fit-row spans.
  // Other content in the box (a reference, a heading) counts for the height through a final
  // real measurement: the size shrinks a step at a time until the box fits.
  function fitBox(box, { lineSelector, maxW, maxH, minSize, maxSize, minPct = DEFAULT_MIN_PCT, lineHeight = 1.22 }) {
    const nodes = [...box.querySelectorAll(lineSelector)];
    for (const node of nodes) if (node.dataset.text === undefined) node.dataset.text = node.textContent;
    const texts = nodes.map((node) => node.dataset.text);
    const probe = document.createElement('span');
    probe.className = 'fit-probe';
    probe.setAttribute('aria-hidden', 'true');
    box.append(probe);
    const measure = (text, size) => {
      probe.style.fontSize = `${size}px`;
      probe.textContent = text || ' ';
      return probe.getBoundingClientRect().width;
    };
    const plan = layout({ lines: texts, measure, maxW, maxH, rowHeight: (s) => s * lineHeight, minSize, maxSize, minPct });
    probe.remove();
    nodes.forEach((node, i) => {
      const rows = plan.rows[i] || [texts[i]];
      node.classList.toggle('fit-wrapped', rows.length > 1);
      if (rows.length === 1) node.textContent = rows[0] || ' ';
      else node.replaceChildren(...rows.map((row) => { const span = document.createElement('span'); span.className = 'fit-row'; span.textContent = row; return span; }));
    });
    let size = plan.size;
    box.style.fontSize = `${size}px`;
    // The real box (headings, margins): shrink one step at a time until it fits.
    for (let i = 0; i < 12 && size > minSize && (box.scrollWidth > maxW + 0.5 || box.scrollHeight > maxH + 0.5); i++) {
      size = Math.max(minSize, size * 0.95);
      box.style.fontSize = `${size}px`;
    }
    return { ...plan, size };
  }

  root.LYRICS_FIT = { ...LOGIC, fitBox };
})(typeof window !== 'undefined' ? window : this);
