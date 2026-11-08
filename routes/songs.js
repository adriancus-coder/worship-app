'use strict';

const fs = require('fs');
const express = require('express');
const { requireRole } = require('../lib/auth');
const { requirePerm, can } = require('../lib/roles');
const { LIMITS, KEYS, COLLECTIONS, SORT_MODES, DuplicateTitleError, validateSong, validateThemes, createSongStore } = require('../lib/songs');
const { THEME_INDEX } = require('../lib/themes');
const { parseArrangement } = require('../lib/sections');
const { parseChoice, createBackgroundStore } = require('../lib/backgrounds');
const { createMediaSigner, createMediaStore, sniffAudio, parseVideoUrl } = require('../lib/media');
const { createMediaQuota } = require('../lib/platform');
const { receiveUpload } = require('../lib/upload');
const { MAX_SONGS, LibraryFileError, parseLibraryFile, planImport } = require('../lib/library-import');
const { createEventStore } = require('../lib/events');
const { createAdminSettings } = require('../lib/admin-settings');
const { todayIn } = require('../lib/dates');

// The import route parses its own body (the global JSON limit is 100 kB, see server.js).
const IMPORT_BODY_LIMIT = '10mb';

// All routes are scoped to req.adminId from the session. A song of another admin
// simply does not exist here: 404, never 403.
function createSongsRouter({ db, auth, config, logger, live, storage }) {
  const backgrounds = createBackgroundStore(db, createMediaSigner(config.DATA_DIR));
  const router = express.Router();
  const songs = createSongStore(db);
  const media = createMediaStore(db, config.DATA_DIR); // the backing tracks (kind 'audio')
  const quota = createMediaQuota(db, config.MEDIA_MAX_ADMIN_BYTES);
  const mb = (bytes) => { const v = bytes / (1024 * 1024); return `${v < 10 ? Number(v.toFixed(1)) : Math.round(v)} MB`; };
  const events = createEventStore(db);
  const settings = createAdminSettings(db);
  // Writing: the 'library' right (both libraries) or the 'school' right (the Sunday school's
  // library only: a song with collection 'school'). mayWrite says which, per song.
  const canEdit = requirePerm('library', 'school');
  // The whole-library tools (export, import, "Detectează gama la toate"): the owner only.
  const ownerOnly = requireRole('owner');
  const mayWrite = (req, collection) => can(req.user, 'library') || (can(req.user, 'school') && collection === 'school');
  const forbidden = (req, res) => res.status(403).json({ error: req.t('errors.forbidden') });
  // A school-only writer always writes into the school's library.
  const ownCollection = (req, wanted) => (can(req.user, 'library') ? wanted : 'school');
  const today = (req) => todayIn(settings.timezone(req.adminId));

  function songId(req) {
    return /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
  }

  function notFound(req, res) {
    res.status(404).json({ error: req.t('errors.songNotFound') });
  }

  function duplicate(req, res, err) {
    res.status(409).json({ error: req.t('errors.songDuplicate'), existingId: err.existingId });
  }

  router.use('/api/songs', auth.requireUser, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/api/songs', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, LIMITS.queryMax) : '';
    const sort = SORT_MODES.includes(req.query.sort) ? req.query.sort : 'az';
    // ?noKey=1: only the songs without a key (the library's "Fără ton" filter); ?theme=<name>:
    // only the songs with that theme; ?noTheme=1: only the songs with no theme at all.
    const theme = typeof req.query.theme === 'string' ? req.query.theme.slice(0, LIMITS.themeMax) : '';
    // ?collection=main (default) | school | all: which library (migration 060)
    const collection = ['school', 'all'].includes(req.query.collection) ? req.query.collection : 'main';
    const list = songs.list(req.adminId, { q, sort, noKey: req.query.noKey === '1', theme, noTheme: req.query.noTheme === '1', collection });
    // ?withHistory=1 adds lastSung (the last date it was sung: lib/events.js lastSungMap).
    if (req.query.withHistory === '1') {
      const day = today(req);
      const last = events.lastSungMap(req.adminId, day);
      return res.json({ today: day, songs: list.map((s) => ({ ...s, lastSung: last.get(s.id) || null })) });
    }
    res.json({ songs: list });
  });

  // Library file import. ?dryRun=1 only reports; otherwise mode=skip (default) keeps
  // existing songs, mode=update replaces their sections and metadata. One transaction.
  router.post('/api/songs/import', ownerOnly, express.json({ limit: IMPORT_BODY_LIMIT }), (req, res) => {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const mode = req.query.mode === undefined ? 'skip' : req.query.mode;
    if (!['skip', 'update'].includes(mode)) return res.status(400).json({ error: req.t('errors.importMode') });
    // a school-only writer: everything lands in the school's library, nothing is updated
    const schoolOnly = !can(req.user, 'library');
    if (schoolOnly && mode === 'update') return res.status(400).json({ error: req.t('errors.importMode') });
    // ?collection=main|school: the library the new songs go into (the import form's choice);
    // without it the file's own collection of each song counts. Songs that already exist
    // keep their library either way: an update replaces their content, not their shelf.
    if (req.query.collection !== undefined && !COLLECTIONS.includes(req.query.collection)) return res.status(400).json({ error: req.t('errors.songCollectionInvalid') });
    const target = schoolOnly ? 'school' : (req.query.collection || null);

    let file;
    try {
      file = parseLibraryFile(req.body);
    } catch (err) {
      if (!(err instanceof LibraryFileError)) throw err;
      const key = err.code === 'too_many' ? 'errors.importTooMany' : 'errors.importFormat';
      return res.status(400).json({ error: req.t(key, { max: MAX_SONGS }) });
    }
    const plan = () => planImport(file.entries, {
      t: req.t,
      findIdByTitle: (title) => songs.findIdByTitle(req.adminId, title),
    });

    if (dryRun) {
      const p = plan();
      return res.json({
        format: file.format,
        new: p.add.map((x) => x.value.title),
        existing: p.existing.map((x) => x.value.title),
        invalid: p.invalid,
      });
    }

    // An existing song never loses what the file does not bring: its library, key, author,
    // "Cum se cântă", source and background / backing track stay unless the file has a
    // value; its themes and the file's are merged (the file's "Caietul bisericii" lands on
    // it). mode=update replaces the text (sections, title); skip leaves the text alone and
    // still merges the themes.
    const mergedThemes = (current, value) => validateThemes([...current.themes, ...value.themes.map((x) => x.name)], req.t).value;
    const before = mode === 'update' ? live.songBefore(req.adminId) : [];
    const result = db.transaction(() => {
      const p = plan();
      for (const { value, meta } of p.add) songs.create(req.adminId, req.user.id, target ? { ...value, collection: target } : value, meta);
      for (const { id, value, meta, keepAuthor } of p.existing) {
        const current = songs.get(req.adminId, id);
        const themes = mergedThemes(current, value);
        if (mode !== 'update') {
          if (themes.length !== current.themes.length) songs.setThemes(req.adminId, id, themes);
          continue;
        }
        const song = {
          ...value, collection: current.collection, themes,
          author: keepAuthor || !value.author ? current.author : value.author,
          songKey: value.songKey || current.song_key || null,
        };
        const kept = {};
        for (const key of ['sourceLang', 'sourceProvider', 'sourceUrl', 'presentation']) if (meta && meta[key]) kept[key] = meta[key];
        songs.update(req.adminId, id, song, kept);
      }
      return {
        collection: target || 'file',
        added: p.add.length,
        updated: mode === 'update' ? p.existing.length : 0,
        skipped: mode === 'update' ? 0 : p.existing.length,
        invalid: p.invalid.length,
      };
    })();
    live.songChanged(req.adminId, before);
    logger.info(`Library import (${file.format}, mode=${mode}, into=${target || 'file'}) by user #${req.user.id} (admin #${req.adminId}): `
      + `added=${result.added} updated=${result.updated} skipped=${result.skipped} invalid=${result.invalid}`);
    res.json(result);
  });

  // The library's themes ("tematică"), with how many songs carry each: the library filter,
  // the editor's suggestions, the ideas panel. Registered before /api/songs/:id.
  router.get('/api/songs/themes', (req, res) => {
    res.json({ themes: songs.themes(req.adminId), without: songs.withoutThemes(req.adminId), index: THEME_INDEX });
  });

  // The themes of one song (the song page's "Tematică · Setează"): { themes: [names] }.
  router.put('/api/songs/:id/themes', canEdit, (req, res) => {
    const id = songId(req);
    if (!id) return notFound(req, res);
    const { error, value } = validateThemes((req.body || {}).themes, req.t);
    if (error) return res.status(400).json({ error });
    const existing = songs.get(req.adminId, id);
    if (!existing) return notFound(req, res);
    if (!mayWrite(req, existing.collection)) return forbidden(req, res);
    if (!songs.setThemes(req.adminId, id, value)) return notFound(req, res);
    res.json({ song: songs.get(req.adminId, id) });
  });

  // "Detectează gama la toate" (public/key-suggest.js): the keyless songs with chords and
  // their estimated key; then the keys the user approved, set only where none is set.
  // Registered before /api/songs/:id.
  router.get('/api/songs/key-suggestions', ownerOnly, (req, res) => {
    const out = songs.keySuggestions(req.adminId);
    if (!can(req.user, 'library')) out.songs = out.songs.filter((s) => (songs.get(req.adminId, s.id) || {}).collection === 'school');
    res.json(out);
  });

  router.put('/api/songs/keys', ownerOnly, (req, res) => {
    const list = req.body && req.body.keys;
    if (!Array.isArray(list) || list.length > MAX_SONGS) return res.status(400).json({ error: req.t('errors.songKeyInvalid') });
    const keys = [];
    for (const item of list) {
      const id = item && /^\d{1,15}$/.test(String(item.id)) ? Number(item.id) : null;
      const key = item && typeof item.song_key === 'string' ? item.song_key.trim() : null;
      if (!id || !key || !KEYS.includes(key)) return res.status(400).json({ error: req.t('errors.songKeyInvalid') });
      keys.push({ id, songKey: key });
    }
    const allowed = keys.filter((k) => { const song = songs.get(req.adminId, k.id); return song && mayWrite(req, song.collection); });
    const before = live.songBefore(req.adminId);
    const result = songs.setKeys(req.adminId, allowed);
    result.skipped.push(...keys.filter((k) => !allowed.includes(k)).map((k) => k.id));
    if (result.saved.length) live.songChanged(req.adminId, before);
    res.json(result);
  });

  // Registered before /api/songs/:id.
  router.get('/api/songs/export', ownerOnly, (req, res) => {
    const payload = songs.exportLibrary(req.adminId, config.APP_NAME, can(req.user, 'library') ? (['main', 'school'].includes(req.query.collection) ? req.query.collection : 'all') : 'school');
    const filename = `worship-app-library-${payload.exportedAt.slice(0, 10)}.json`;
    logger.info(`Library exported by user #${req.user.id} (admin #${req.adminId}, ${payload.count} songs)`);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  // The events this song is in (not templates), newest first.
  router.get('/api/songs/:id/history', (req, res) => {
    const id = songId(req);
    if (!id || !songs.findTitle(req.adminId, id)) return notFound(req, res);
    const day = today(req);
    const dates = events.songHistory(req.adminId, id);
    const lastSung = dates.find((d) => d.eventDate <= day);
    res.json({ songId: id, today: day, lastSung: lastSung ? lastSung.eventDate : null, dates });
  });

  // The backing track ("negativ") as the pages see it: a file { kind: 'file', id, title,
  // mime, sizeBytes, src } (src: the session-guarded file route), a link { kind: 'youtube',
  // id, url }, or null.
  function audioOf(adminId, song) {
    if (song.audioUrl) {
      const parsed = parseVideoUrl(song.audioUrl);
      if (parsed && parsed.kind === 'youtube') return { kind: 'youtube', id: parsed.id, url: song.audioUrl };
    }
    const row = song.audioMediaId ? media.get(adminId, song.audioMediaId) : null;
    return row ? { kind: 'file', id: row.id, title: row.title, mime: row.mime, sizeBytes: row.sizeBytes, src: `/api/media/${row.id}/file` } : null;
  }
  // a track replaced: the previous file goes
  const dropAudioFile = (adminId, song) => { if (song.audioMediaId) media.remove(adminId, song.audioMediaId); };
  const withAudio = (adminId, song) => ({ ...song, audio: audioOf(adminId, song) });

  router.get('/api/songs/:id', (req, res) => {
    const id = songId(req);
    const song = id && songs.get(req.adminId, id);
    if (!song) return notFound(req, res);
    res.json({ song: withAudio(req.adminId, song) });
  });

  // "Cum se cântă" (the song page): the song's own section order, the default arrangement
  // of every event. { codes: ['V1', 'C', 'V2', 'C'] } of the song's sections (400 for a code
  // that is not one of them); [] goes back to the sections' order. The song's editors.
  router.put('/api/songs/:id/presentation', canEdit, (req, res) => {
    const id = songId(req);
    const song = id && songs.get(req.adminId, id);
    if (!song) return notFound(req, res);
    if (!mayWrite(req, song.collection)) return forbidden(req, res);
    const codes = (req.body || {}).codes;
    if (!Array.isArray(codes) || codes.length > 60 || !codes.every((c) => typeof c === 'string')) return res.status(400).json({ error: req.t('errors.presentationInvalid') });
    const parsed = parseArrangement(codes.join(' '), song.sections);
    if (parsed.unknown.length || parsed.codes.length !== codes.length) return res.status(400).json({ error: req.t('errors.presentationInvalid') });
    const before = live.songBefore(req.adminId, id);
    songs.setPresentation(req.adminId, id, parsed.codes.length ? parsed.codes.join(' ') : null);
    live.songChanged(req.adminId, before);
    res.json({ song: withAudio(req.adminId, songs.get(req.adminId, id)) });
  });

  // The backing track: the body is the audio file (MP3 / M4A / WAV / OGG), streamed to disk
  // like a media upload (the file limit MEDIA_MAX_AUDIO_BYTES, the church's quota, the
  // disk), checked by its first bytes, stored as media kind 'audio' and linked to the song
  // (a previous track goes). Those who may edit the song (the library right; the school
  // right on the school's songs). DELETE unlinks and removes the file.
  router.post('/api/songs/:id/audio', canEdit, (req, res) => {
    const id = songId(req);
    const song = id && songs.get(req.adminId, id);
    if (!song) return notFound(req, res);
    if (!mayWrite(req, song.collection)) return forbidden(req, res);
    const maxFile = config.MEDIA_MAX_AUDIO_BYTES;
    const maxAdmin = quota(req.adminId);
    const room = maxAdmin - media.usedBytes(req.adminId);
    const diskRoom = storage.room();
    const limit = Math.min(maxFile, room, diskRoom);
    const tooLarge = (bytes) => {
      if (bytes > maxFile) return [413, req.t('errors.audioTooLarge', { max: mb(maxFile) })];
      if (bytes > room) return [413, req.t('errors.mediaQuotaExceeded', { max: mb(maxAdmin) })];
      return [507, req.t('errors.diskFull', { free: mb(Math.max(0, diskRoom)), pct: config.DISK_MIN_FREE_PCT })];
    };
    const temp = media.tempPath(req.adminId);
    receiveUpload(req, res, { temp, limit, tooLarge, t: req.t, logger }).then((got) => {
      if (!got) return;
      const mime = sniffAudio(got.head);
      if (!mime) {
        fs.rm(temp, { force: true }, () => {});
        return res.status(400).json({ error: req.t('errors.audioInvalid') });
      }
      const title = typeof req.query.title === 'string' && req.query.title.trim() ? req.query.title.trim().slice(0, 120) : `${song.title} – negativ`;
      const before = live.songBefore(req.adminId, id);
      const item = db.transaction(() => {
        const added = media.addUpload(req.adminId, req.user.id, { title, temp, mime, size: got.size, kind: 'audio' });
        songs.setAudio(req.adminId, id, { mediaId: added.id });
        dropAudioFile(req.adminId, song);
        return added;
      })();
      live.songChanged(req.adminId, before);
      storage.refresh();
      logger.info(`Backing track #${item.id} (${mime}, ${got.size} bytes) set on song #${id} by user #${req.user.id} (admin #${req.adminId})`);
      res.status(201).json({ audio: audioOf(req.adminId, { audioMediaId: item.id }) });
    }).catch((err) => {
      logger.error('backing track upload failed', err);
      if (!res.headersSent) res.status(500).json({ error: req.t('errors.internal') });
    });
  });
  // The backing track as a YouTube link { url } (youtube.com / youtu.be; the embedded player
  // plays it, so it needs the internet). It replaces a file.
  router.put('/api/songs/:id/audio-url', canEdit, (req, res) => {
    const id = songId(req);
    const song = id && songs.get(req.adminId, id);
    if (!song) return notFound(req, res);
    if (!mayWrite(req, song.collection)) return forbidden(req, res);
    const parsed = parseVideoUrl((req.body || {}).url);
    if (!parsed || parsed.kind !== 'youtube') return res.status(400).json({ error: req.t('errors.audioUrlInvalid') });
    const url = `https://www.youtube.com/watch?v=${parsed.id}`;
    const before = live.songBefore(req.adminId, id);
    db.transaction(() => {
      songs.setAudio(req.adminId, id, { url });
      dropAudioFile(req.adminId, song);
    })();
    live.songChanged(req.adminId, before);
    if (song.audioMediaId) storage.refreshSoon();
    logger.info(`Backing track link set on song #${id} by user #${req.user.id} (admin #${req.adminId})`);
    res.json({ audio: audioOf(req.adminId, { audioUrl: url }) });
  });
  router.delete('/api/songs/:id/audio', canEdit, (req, res) => {
    const id = songId(req);
    const song = id && songs.get(req.adminId, id);
    if (!song) return notFound(req, res);
    if (!mayWrite(req, song.collection)) return forbidden(req, res);
    if (song.audioMediaId || song.audioUrl) {
      const before = live.songBefore(req.adminId, id);
      songs.setAudio(req.adminId, id, {});
      dropAudioFile(req.adminId, song);
      live.songChanged(req.adminId, before);
      if (song.audioMediaId) storage.refreshSoon();
      logger.info(`Backing track removed from song #${id} by user #${req.user.id} (admin #${req.adminId})`);
    }
    res.json({ audio: null });
  });

  router.post('/api/songs', canEdit, (req, res) => {
    const { error, value } = validateSong(req.body, req.t);
    if (error) return res.status(400).json({ error });
    value.collection = ownCollection(req, value.collection);
    try {
      const id = songs.create(req.adminId, req.user.id, value);
      logger.info(`Song #${id} created by user #${req.user.id} (admin #${req.adminId})`);
      res.status(201).json({ song: songs.get(req.adminId, id) });
    } catch (err) {
      if (err instanceof DuplicateTitleError) return duplicate(req, res, err);
      throw err;
    }
  });

  router.put('/api/songs/:id', canEdit, (req, res) => {
    const id = songId(req);
    if (!id) return notFound(req, res);
    // A body with only song_key sets the original key and nothing else (the arrange sheet).
    const body = req.body || {};
    const existing = songs.get(req.adminId, id);
    if (!existing) return notFound(req, res);
    if (!mayWrite(req, existing.collection)) return forbidden(req, res);
    if (Object.keys(body).length === 1 && 'song_key' in body) {
      const key = typeof body.song_key === 'string' ? body.song_key.trim() : null;
      if (key === null || (key && !KEYS.includes(key))) return res.status(400).json({ error: req.t('errors.songKeyInvalid') });
      const before = live.songBefore(req.adminId, id);
      if (!songs.setKey(req.adminId, id, key)) return notFound(req, res);
      live.songChanged(req.adminId, before);
      return res.json({ song: songs.get(req.adminId, id) });
    }
    const { error, value } = validateSong(req.body, req.t);
    if (error) return res.status(400).json({ error });
    if (body.collection === undefined) value.collection = existing.collection; // not given: the song stays where it is
    else if (!mayWrite(req, value.collection)) return forbidden(req, res);
    try {
      const before = live.songBefore(req.adminId, id);
      if (!songs.update(req.adminId, id, value)) return notFound(req, res);
      live.songChanged(req.adminId, before);
      res.json({ song: songs.get(req.adminId, id) });
    } catch (err) {
      if (err instanceof DuplicateTitleError) return duplicate(req, res, err);
      throw err;
    }
  });

  // The song's default background (lib/backgrounds.js): null (the church default), 'none'
  // or a background from the media library.
  router.put('/api/songs/:id/background', canEdit, (req, res) => {
    const id = songId(req);
    const existing = id ? songs.get(req.adminId, id) : null;
    if (!existing) return notFound(req, res);
    if (!mayWrite(req, existing.collection)) return forbidden(req, res);
    const choice = parseChoice((req.body || {}).background);
    if (choice.error || choice.value === undefined
      || (typeof choice.value === 'number' && !backgrounds.find(req.adminId, choice.value))) {
      return res.status(400).json({ error: req.t('errors.backgroundChoiceInvalid') });
    }
    backgrounds.setSongBackground(req.adminId, id, choice.value);
    live.backgroundsChanged(req.adminId);
    res.json({ song: songs.get(req.adminId, id) });
  });

  router.delete('/api/songs/:id', canEdit, (req, res) => {
    const id = songId(req);
    const existing = id ? songs.get(req.adminId, id) : null;
    if (existing && !mayWrite(req, existing.collection)) return forbidden(req, res);
    const before = id ? live.songBefore(req.adminId, id) : [];
    if (!id || !songs.remove(req.adminId, id)) return notFound(req, res);
    live.songChanged(req.adminId, before);
    logger.info(`Song #${id} deleted by user #${req.user.id} (admin #${req.adminId})`);
    res.json({ ok: true });
  });

  return router;
}

module.exports = createSongsRouter;
