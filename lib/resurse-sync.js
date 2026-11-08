'use strict';

// "Acorduri și teme de pe resurse" (the library's "⋯" menu): one job per admin that goes
// through EVERY song of a library, looks each up on resursecrestine.ro by title and, when the
// site has the same song, brings its chords over the song's OWN lines where the song has none
// (lib/resurse.js overlayChords: the text stays as written here) and adds the site's themes
// ("Tematica") the song does not have yet, themes of its own or not: a song with a theme set
// here may carry another one on the site. The key is set only where none is set. One song at
// a time, a pause between songs (the site is public and not ours), progress and a report the
// page polls (GET); the report stays until the next run or a restart.
//
//   createResurseSync({ db, logger, live, resurse, delayMs })
//     plan(adminId, collection)        -> { total, withoutChords, withoutThemes } (total: all the songs)
//     start(adminId, collection, t)    -> job (throws 'running' when one already runs)
//     status(adminId)                  -> job | null
//     cancel(adminId)                  -> true when a job was running
//
// A song's report entry: { id, title, status, themes, key, url, score }
//   chords     chords put over its lines (and themes, when the site had any)
//   themes     the site has the song and its themes were added; no chords (the site has
//              none, or its lines differ: score below MIN_OVERLAY)
//   different  the site has a song with this title but another text
//   notFound   no song with this title on the site
//   error      the site could not be read for this song
//   skipped    nothing new to bring (the chords already there, no theme it lacks)

const { createSongStore, validateSong } = require('./songs');
const { normalizeForSearch } = require('./search');

const MIN_OVERLAY = 0.6; // of the song's lines must get the site's chords (same song, same lines)
const MIN_SAME = 0.5; // of the song's lines must be on the site for its themes to apply
const MAX_CANDIDATES = 3; // search hits with this title that are looked at
const DEFAULT_DELAY_MS = 1200;

function createResurseSync({ db, logger, live, resurse, delayMs = DEFAULT_DELAY_MS }) {
  const songs = createSongStore(db);
  const { inlineLinePairs, inlineToChordsOverLyrics } = require('./chords');
  const jobs = new Map(); // adminId -> job

  const hasChords = (sections) => sections.some((s) => inlineLinePairs(s.content).some((p) => p.chords !== null));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // All the songs of a library (or all), with what each lacks: the chords come only where
  // there are none; the site's new themes are added to every song (needThemes is always on).
  function candidates(adminId, collection) {
    const rows = songs.list(adminId, { q: '', sort: 'az', collection: collection === 'all' ? 'all' : collection });
    const out = [];
    for (const row of rows) {
      const song = songs.get(adminId, row.id);
      if (!song) continue;
      out.push({ song, needChords: !hasChords(song.sections), needThemes: true, hasThemes: song.themes.length > 0 });
    }
    return out;
  }

  function plan(adminId, collection) {
    const list = candidates(adminId, collection);
    return { total: list.length, withoutChords: list.filter((x) => x.needChords).length, withoutThemes: list.filter((x) => !x.hasThemes).length };
  }

  // The lines of a song as normalized keys (empty ones dropped).
  const lineKeys = (sections) => sections.flatMap((s) => String(s.content || '').split('\n').map((l) => resurse.normalizeLyric(l)).filter(Boolean));

  // How much of this song's text the site's song has (0..1).
  function sameness(ours, theirs) {
    const have = new Set(lineKeys(theirs));
    const keys = lineKeys(ours);
    if (!keys.length) return 0;
    return keys.filter((k) => have.has(k)).length / keys.length;
  }

  // One song: look it up, bring what fits. -> the report entry
  async function syncSong(adminId, { song, needChords, needThemes }, t, fetchOptions) {
    const entry = { id: song.id, title: song.title, status: 'notFound', themes: [], key: null, url: null, score: 0 };
    let results;
    try {
      results = await resurse.searchResurseCrestineSongs(song.title, fetchOptions);
    } catch (err) {
      entry.status = 'error';
      return entry;
    }
    const wanted = normalizeForSearch(song.title);
    const hits = results.filter((r) => r.kind === 'song' && normalizeForSearch(r.title) === wanted).slice(0, MAX_CANDIDATES);
    if (!hits.length) return entry;
    // every hit: the site's song with its chords; the one most like ours wins
    let best = null;
    for (const hit of hits) {
      let theirs;
      try {
        theirs = await resurse.fetchResurseCrestineSong(hit.id, { ...fetchOptions, sheet: needChords ? 'auto' : 'none' });
      } catch (err) {
        entry.status = 'error';
        continue;
      }
      const same = sameness(song.sections, theirs.sections);
      let overlay = null;
      if (needChords && hasChords(theirs.sections)) {
        const sheetText = theirs.sections.map((s) => inlineToChordsOverLyrics(s.content)).join('\n\n');
        overlay = resurse.overlayChords(song.sections, sheetText);
      }
      const score = overlay ? overlay.score : same;
      if (!best || score > best.score || (score === best.score && same > best.same)) best = { hit, theirs, same, overlay, score };
    }
    if (!best) return entry;
    entry.url = best.hit.url;
    entry.score = Math.round(Math.max(best.same, best.overlay ? best.overlay.score : 0) * 100) / 100;
    const chordsFit = Boolean(best.overlay) && best.overlay.score >= MIN_OVERLAY;
    const isSame = best.same >= MIN_SAME || chordsFit;
    if (!isSame) {
      entry.status = 'different';
      return entry;
    }
    const newThemes = needThemes ? best.theirs.themes.filter((name) => !song.themes.some((have) => normalizeForSearch(have) === normalizeForSearch(name))) : [];
    if (!chordsFit && !newThemes.length) {
      entry.status = 'skipped';
      return entry;
    }
    const input = {
      title: song.title, author: song.author, collection: song.collection,
      song_key: song.song_key || (chordsFit && best.theirs.key) || '',
      themes: [...song.themes, ...newThemes],
      sections: (chordsFit ? best.overlay.sections : song.sections).map((s) => ({ type: s.type, label: s.label || '', content: s.content, note: s.note || '' })),
    };
    const { error, value } = validateSong(input, t);
    if (error) {
      entry.status = 'error';
      logger.warn(`resurse sync: song #${song.id} rejected (${error})`);
      return entry;
    }
    const meta = song.source_url ? {} : { sourceProvider: 'resursecrestine.ro', sourceUrl: best.theirs.sourceUrl || best.hit.url };
    const before = live.songBefore(adminId, song.id);
    songs.update(adminId, song.id, value, meta);
    live.songChanged(adminId, before);
    entry.status = chordsFit ? 'chords' : 'themes';
    entry.themes = newThemes;
    entry.key = !song.song_key && value.songKey ? value.songKey : null;
    return entry;
  }

  function start(adminId, collection, t, fetchOptions = {}) {
    const running = jobs.get(adminId);
    if (running && running.running) throw new Error('running');
    const list = candidates(adminId, collection);
    const job = { running: true, cancelled: false, collection, total: list.length, done: 0, current: null, report: [], startedAt: Date.now(), finishedAt: null };
    jobs.set(adminId, job);
    (async () => {
      for (const item of list) {
        if (job.cancelled) break;
        job.current = item.song.title;
        try {
          job.report.push(await syncSong(adminId, item, t, fetchOptions));
        } catch (err) {
          logger.error(`resurse sync: song #${item.song.id} failed`, err);
          job.report.push({ id: item.song.id, title: item.song.title, status: 'error', themes: [], key: null, url: null, score: 0 });
        }
        job.done++;
        if (!job.cancelled && job.done < job.total && delayMs > 0) await sleep(delayMs);
      }
      job.current = null;
      job.running = false;
      job.finishedAt = Date.now();
      const counts = {};
      for (const e of job.report) counts[e.status] = (counts[e.status] || 0) + 1;
      logger.info(`resurse sync for admin #${adminId} (${collection}): ${job.done}/${job.total} songs, ${JSON.stringify(counts)}${job.cancelled ? ', cancelled' : ''}`);
    })();
    return job;
  }

  function status(adminId) {
    return jobs.get(adminId) || null;
  }

  function cancel(adminId) {
    const job = jobs.get(adminId);
    if (!job || !job.running) return false;
    job.cancelled = true;
    return true;
  }

  return { plan, start, status, cancel, MIN_OVERLAY, MIN_SAME };
}

module.exports = { createResurseSync, MIN_OVERLAY, MIN_SAME, DEFAULT_DELAY_MS };
