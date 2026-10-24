'use strict';

// Key (tonality) estimation for songs without a key. Shared by the pages and the server
// (lib/key-detect.js), pure functions only.
//
// A) From chords: the chords of the song (inline ChordPro "[G]", chord lines over lyrics,
//    letters, Romanian solfège or H = B) build a profile of the 12 pitch classes (root 1.0,
//    third 0.8, fifth 0.6, seventh 0.3, slash bass 0.3; the first chord x1.5, the last x2.2).
// B) From a recording: Hann windows of 16384 samples, an FFT, the bins between 80 and 2500 Hz
//    mapped to the 12 pitch classes, every frame normalised, near-silent frames skipped, at
//    most ~360 frames spread over the whole recording, summed into the same kind of profile.
// Then Krumhansl-Schmuckler: the Pearson correlation of the profile with the Krumhansl-Kessler
// major and minor key profiles in the 24 keys. The result is the best key, two more
// candidates and a confidence from the gap between the first two scores.

(function (root) {
  const CHORDS = typeof module === 'object' && module.exports ? require('./chords.js') : root.CHORDS;

  const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const CHORD_PARTS_RE = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/;
  const SOLFEGE_RE = /^(Do|Re|Mi|Fa|Sol|La|Si)([#b]?)(.*?)(?:\/(Do|Re|Mi|Fa|Sol|La|Si)([#b]?))?$/;
  const SOLFEGE_LETTER = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };
  const INLINE_CHORD_RE = /\[([^\]\n]*)\]/g;

  // Krumhansl & Kessler (1982) key profiles, from the tonic up.
  const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  const WEIGHTS = { root: 1.0, third: 0.8, fifth: 0.6, seventh: 0.3, bass: 0.3, first: 1.5, last: 2.2 };
  const SURE_GAP = 0.08;
  const LIKELY_GAP = 0.03;

  function mod12(n) {
    return ((n % 12) + 12) % 12;
  }

  function noteIndex(letter, accidental) {
    return mod12(NATURAL[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0));
  }

  // --- chords ------------------------------------------------------------------------------

  // A chord as written -> letters: "Sol7" -> "G7", "H" -> "B", "Hm/F#" -> "Bm/F#"; null when
  // the token is not a chord (lyrics, "|", N.C.).
  function toLetters(token) {
    let text = String(token || '').trim();
    if (!text || text === '|' || /^N\.?C\.?$/.test(text)) return null;
    text = text.replace(/^H(?=[#b]?(?:$|[^a-z]|m(?!aj)|maj|dim|aug|sus|add))/, 'B').replace(/\/H([#b]?)$/, '/B$1');
    const m = SOLFEGE_RE.exec(text);
    if (m) text = SOLFEGE_LETTER[m[1]] + m[2] + m[3] + (m[4] ? `/${SOLFEGE_LETTER[m[4]]}${m[5]}` : '');
    return CHORDS.isChord(text) && CHORD_PARTS_RE.test(text) ? text : null;
  }

  // { root, third, fifth, seventh, bass } as pitch classes (null when the chord has none),
  // for a letter chord; null when it is not one.
  function chordTones(chord) {
    const text = toLetters(chord);
    const m = text && CHORD_PARTS_RE.exec(text);
    if (!m) return null;
    const rootIndex = noteIndex(m[1], m[2]);
    const quality = m[3];
    const minor = /^m(?!aj)/.test(quality) || /^(dim|°|ø)/.test(quality);
    const dim = /^(dim|°|ø)/.test(quality);
    const aug = /^(aug|\+)/.test(quality);
    const sus = /^sus/.test(quality);
    let third = sus ? null : mod12(rootIndex + (minor ? 3 : 4));
    if (/^(5)$/.test(quality)) third = null; // power chord
    const fifth = mod12(rootIndex + (dim || /b5/.test(quality) ? 6 : aug || /#5/.test(quality) ? 8 : 7));
    let seventh = null;
    if (/maj7|M7|Δ/.test(quality)) seventh = mod12(rootIndex + 11);
    else if (/^(dim7|°7)/.test(quality)) seventh = mod12(rootIndex + 9);
    else if (/(^|[^\d])(7|9|11|13)(?!\d)/.test(quality.replace(/^(sus|add|maj|dim|aug)/, ''))
      && !/^add/.test(quality)) seventh = mod12(rootIndex + 10);
    const bass = m[4] ? noteIndex(m[4], m[5]) : null;
    return { root: rootIndex, third, fifth, seventh, bass: bass === null || bass === rootIndex ? null : bass };
  }

  // The chords of a text, in order: inline ChordPro chords ("[G]") when there are any, else
  // the chords of every chord line (chords over lyrics or a plain progression "G D Em C").
  // Lyrics are ignored. Letters as the result ("Sol" -> "G", "H" -> "B").
  function chordsInText(text) {
    const content = String(text || '');
    const inline = [];
    let m;
    INLINE_CHORD_RE.lastIndex = 0;
    while ((m = INLINE_CHORD_RE.exec(content))) {
      const chord = toLetters(m[1]);
      if (chord) inline.push(chord);
    }
    if (inline.length) return inline;
    const out = [];
    for (const line of content.split(/\r?\n/)) {
      const hLine = line.replace(/(^|\s)H(?=[#b]?(?:m|7|maj|sus|dim|aug|\/|\s|$))/g, '$1B');
      if (!CHORDS.isChordLine(hLine) && !CHORDS.isChordLine(line)) continue;
      for (const token of line.trim().split(/\s+/)) {
        const chord = toLetters(token);
        if (chord) out.push(chord);
      }
    }
    return out;
  }

  // The chords of a song's sections ([{ content }]), in order.
  function chordsInSections(sections) {
    return (Array.isArray(sections) ? sections : []).flatMap((s) => chordsInText(s && s.content));
  }

  // The 12-bin profile of a chord list (see the weights above).
  function chordProfile(chords) {
    const profile = new Array(12).fill(0);
    const list = (Array.isArray(chords) ? chords : []).map(chordTones).filter(Boolean);
    list.forEach((tones, i) => {
      let factor = 1;
      if (i === 0) factor *= WEIGHTS.first;
      if (i === list.length - 1) factor *= WEIGHTS.last;
      profile[tones.root] += WEIGHTS.root * factor;
      if (tones.third !== null) profile[tones.third] += WEIGHTS.third * factor;
      profile[tones.fifth] += WEIGHTS.fifth * factor;
      if (tones.seventh !== null) profile[tones.seventh] += WEIGHTS.seventh * factor;
      if (tones.bass !== null) profile[tones.bass] += WEIGHTS.bass * factor;
    });
    return profile;
  }

  // --- Krumhansl-Schmuckler ----------------------------------------------------------------

  function pearson(a, b) {
    const n = a.length;
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < n; i += 1) { sa += a[i]; sb += b[i]; }
    const ma = sa / n;
    const mb = sb / n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i += 1) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }

  // The key name in the app's format ('G', 'Em', 'Bb', 'F#m'): the flat spelling for the
  // keys written with flats (CHORDS.FLAT_KEYS), sharps otherwise.
  function keyName(tonic, minor) {
    const suffix = minor ? 'm' : '';
    const flat = FLAT_NAMES[tonic] + suffix;
    return CHORDS.FLAT_KEYS.includes(flat) ? flat : SHARP_NAMES[tonic] + suffix;
  }

  // All 24 keys scored against a 12-bin profile, best first: [{ key, score }].
  function scoreKeys(profile) {
    const scores = [];
    for (let tonic = 0; tonic < 12; tonic += 1) {
      for (const minor of [false, true]) {
        const template = new Array(12);
        const source = minor ? MINOR_PROFILE : MAJOR_PROFILE;
        for (let i = 0; i < 12; i += 1) template[mod12(tonic + i)] = source[i];
        scores.push({ key: keyName(tonic, minor), score: pearson(profile, template) });
      }
    }
    return scores.sort((a, b) => b.score - a.score);
  }

  // { key, alternatives: [key, key], confidence: 'sure' | 'likely' | 'unsure', scores } for
  // a profile; null when the profile is empty.
  function estimate(profile) {
    if (!profile || !profile.some((v) => v > 0)) return null;
    const scores = scoreKeys(profile);
    const gap = scores[0].score - scores[1].score;
    return {
      key: scores[0].key,
      alternatives: scores.slice(1, 3).map((s) => s.key),
      confidence: gap > SURE_GAP ? 'sure' : gap > LIKELY_GAP ? 'likely' : 'unsure',
      scores: scores.slice(0, 3),
    };
  }

  // A) From a chord list, a text with chords, or a song's sections.
  function fromChords(chords) {
    const result = estimate(chordProfile(chords));
    return result && { ...result, chords: (Array.isArray(chords) ? chords : []).length };
  }
  function fromText(text) {
    return fromChords(chordsInText(text));
  }
  function fromSections(sections) {
    return fromChords(chordsInSections(sections));
  }

  // --- audio -------------------------------------------------------------------------------

  const FRAME = 16384;
  const MIN_HZ = 80;
  const MAX_HZ = 2500;
  const MAX_FRAMES = 360;

  // In-place iterative radix-2 FFT of (re, im), length a power of two.
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const angle = (-2 * Math.PI) / len;
      const wr = Math.cos(angle);
      const wi = Math.sin(angle);
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < len / 2; k += 1) {
          const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k + len / 2] = re[i + k] - ar;
          im[i + k + len / 2] = im[i + k] - ai;
          re[i + k] += ar;
          im[i + k] += ai;
          const next = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = next;
        }
      }
    }
  }

  let hann = null;
  function hannWindow() {
    if (!hann) {
      hann = new Float32Array(FRAME);
      for (let i = 0; i < FRAME; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
    }
    return hann;
  }

  // The pitch class of every FFT bin between MIN_HZ and MAX_HZ (-1 outside).
  function binClasses(sampleRate) {
    const classes = new Int8Array(FRAME / 2);
    for (let k = 0; k < FRAME / 2; k += 1) {
      const hz = (k * sampleRate) / FRAME;
      classes[k] = hz >= MIN_HZ && hz <= MAX_HZ ? mod12(Math.round(69 + 12 * Math.log2(hz / 440))) : -1;
    }
    return classes;
  }

  // The 12-bin profile of mono samples (Float32Array / array of numbers in -1..1), or null
  // when the recording is too short or silent.
  function audioProfile(samples, sampleRate) {
    const n = samples.length;
    if (!n || !sampleRate) return null;
    const data = n < FRAME ? Object.assign(new Float32Array(FRAME), Array.from(samples)) : samples;
    const total = data.length;
    const hop = Math.max(FRAME / 2, Math.floor((total - FRAME) / (MAX_FRAMES - 1)) || FRAME / 2);
    let overall = 0;
    for (let i = 0; i < total; i += 1) overall += data[i] * data[i];
    overall = Math.sqrt(overall / total);
    if (overall < 1e-5) return null;
    const window = hannWindow();
    const classes = binClasses(sampleRate);
    const profile = new Array(12).fill(0);
    const re = new Float64Array(FRAME);
    const im = new Float64Array(FRAME);
    let frames = 0;
    for (let start = 0; start + FRAME <= total && frames < MAX_FRAMES; start += hop) {
      let energy = 0;
      for (let i = 0; i < FRAME; i += 1) energy += data[start + i] * data[start + i];
      if (Math.sqrt(energy / FRAME) < Math.max(1e-4, overall * 0.05)) continue; // near silent
      for (let i = 0; i < FRAME; i += 1) { re[i] = data[start + i] * window[i]; im[i] = 0; }
      fft(re, im);
      const chroma = new Array(12).fill(0);
      for (let k = 1; k < FRAME / 2; k += 1) {
        if (classes[k] < 0) continue;
        chroma[classes[k]] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      }
      const sum = chroma.reduce((a, b) => a + b, 0);
      if (!sum) continue;
      for (let i = 0; i < 12; i += 1) profile[i] += chroma[i] / sum;
      frames += 1;
    }
    return frames ? profile : null;
  }

  // B) From mono samples: the same result shape as fromChords, plus `frames`.
  function fromAudio(samples, sampleRate) {
    const profile = audioProfile(samples, sampleRate);
    const result = estimate(profile);
    return result && { ...result, frames: Math.round(profile.reduce((a, b) => a + b, 0)) };
  }

  const KEY_DETECT = {
    WEIGHTS, SURE_GAP, LIKELY_GAP, FRAME, MIN_HZ, MAX_HZ, MAX_FRAMES,
    toLetters, chordTones, chordsInText, chordsInSections, chordProfile,
    scoreKeys, estimate, fromChords, fromText, fromSections,
    fft, audioProfile, fromAudio,
  };

  if (typeof module === 'object' && module.exports) module.exports = KEY_DETECT;
  else root.KEY_DETECT = KEY_DETECT;
})(typeof window !== 'undefined' ? window : this);
