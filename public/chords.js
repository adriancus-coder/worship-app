'use strict';

// Chord helpers for inline ChordPro content ("[G]Ne ridici din [D]noaptea grea").
// Shared by the pages and the server (lib/chords.js).

(function (root) {
  // G, D/F#, Em7, Bbmaj7, Csus4, Am7b5, C(add9), E7#9, Gm/Bb, N.C.
  // Minor is written "m" only: "Amin" is the Romanian word (Amen), not A minor.
  const CHORD_RE = /^(?:N\.?C\.?|[A-G][#b]?(?:maj|m|dim|aug|sus|add|M|\+|°|ø)?(?:\d+|maj\d*|sus\d*|add\d+|dim\d*|aug|[#b]\d+|\(\w+\))*(?:\/[A-G][#b]?)?)$/;
  const INLINE_CHORD_RE = /\[([^\]\n]*)\]/g;

  function isChord(token) {
    return CHORD_RE.test(token);
  }

  // A line made only of chords (and optional "|" bar marks), with at least one chord.
  function isChordLine(line) {
    const tokens = String(line || '').trim().split(/\s+/).filter(Boolean);
    const chords = tokens.filter((tok) => tok !== '|');
    return chords.length > 0 && chords.every(isChord);
  }

  // Lyrics only: chords removed, spaces left behind collapsed, chord-only lines dropped.
  function stripChords(content) {
    const out = [];
    for (const line of String(content || '').replace(/\r\n?/g, '\n').split('\n')) {
      const hadChords = /\[[^\]\n]*\]/.test(line);
      const text = line.replace(INLINE_CHORD_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
      if (hadChords && !text) continue;
      out.push(text);
    }
    return out.join('\n');
  }

  // Chords and their start columns in a chord line.
  function chordPositions(line) {
    const found = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m[0] !== '|') found.push({ col: m.index, chord: m[0] });
    }
    return found;
  }

  function insertChords(lyric, chords) {
    let text = lyric;
    const last = chords.length ? chords[chords.length - 1].col : 0;
    if (text.length < last) text = text.padEnd(last, ' ');
    for (let i = chords.length - 1; i >= 0; i--) {
      const { col, chord } = chords[i];
      text = `${text.slice(0, col)}[${chord}]${text.slice(col)}`;
    }
    return text;
  }

  // One chord line + one lyric line -> inline ChordPro, chords inserted at their columns.
  // The chord line is trusted as-is (e.g. OpenSong "." lines), even with unusual chord names.
  function mergeChordLine(chordLine, lyric) {
    return insertChords(lyric || '', chordPositions(chordLine)).trimEnd();
  }

  // "Chord line above lyric line" -> inline ChordPro, keeping chord columns.
  // A chord line without a lyric line below becomes an inline chord-only line.
  // Text that is already inline (or has no chord lines) is returned unchanged.
  function chordsOverLyricsToInline(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').normalize('NFC').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!isChordLine(line)) {
        out.push(line);
        continue;
      }
      const chords = chordPositions(line);
      const next = lines[i + 1];
      if (next !== undefined && next.trim() && !isChordLine(next)) {
        out.push(insertChords(next, chords).trimEnd());
        i++;
      } else {
        out.push(insertChords('', chords).trimEnd());
      }
    }
    return out.join('\n');
  }

  // One inline line -> { chords, lyrics }: chords is a positioned chord line or null,
  // lyrics is the text or null for a chord-only line.
  function splitInlineLine(line) {
    let lyrics = '';
    let chordLine = '';
    let hasChords = false;
    let last = 0;
    let m;
    INLINE_CHORD_RE.lastIndex = 0;
    while ((m = INLINE_CHORD_RE.exec(line)) !== null) {
      lyrics += line.slice(last, m.index);
      last = m.index + m[0].length;
      const chord = m[1].trim();
      if (!chord) continue;
      hasChords = true;
      // Keep one space between neighbouring chords if they would touch.
      const col = Math.max(lyrics.length, chordLine.length ? chordLine.length + 1 : 0);
      chordLine = chordLine.padEnd(col, ' ') + chord;
    }
    lyrics += line.slice(last);
    return {
      chords: hasChords ? chordLine : null,
      lyrics: hasChords && !lyrics.trim() ? null : lyrics.trimEnd(),
    };
  }

  // For display: [{ chords, lyrics }] per content line.
  function inlineLinePairs(content) {
    return String(content || '').replace(/\r\n?/g, '\n').split('\n').map(splitInlineLine);
  }

  // Inline ChordPro -> "chord line above lyric line" text.
  function inlineToChordsOverLyrics(content) {
    const out = [];
    for (const { chords, lyrics } of inlineLinePairs(content)) {
      if (chords !== null) out.push(chords);
      if (lyrics !== null) out.push(lyrics);
    }
    return out.join('\n');
  }

  const CHORDS = {
    isChord,
    isChordLine,
    stripChords,
    chordsOverLyricsToInline,
    mergeChordLine,
    inlineToChordsOverLyrics,
    inlineLinePairs,
  };

  if (typeof module === 'object' && module.exports) module.exports = CHORDS;
  else root.CHORDS = CHORDS;
})(typeof window !== 'undefined' ? window : this);
