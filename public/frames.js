'use strict';

// What the projector shows: a small render model ("frame") built from the live state.
// Shared by the server (lib/projector.js) and the pages, so a page holding the event data
// computes exactly the frame the server would (the leader's emergency mode).
// Chords never reach the projector: song sections are sent as lyrics lines only.
//
//   { kind: 'idle',  logoUrl }         no live event for this admin (logo if set, else black)
//   { kind: 'black' }                  black screen (also a video item shown as content: videos
//                                      play only through video.prepare / video.play)
//   { kind: 'logo',  logoUrl }         the church logo (null -> black)
//   { kind: 'lyrics', lines }          the current section of a song, without chords
//   { kind: 'verse', reference, text }
//   { kind: 'announcement', title, body }
//   { kind: 'title', title }           sermon / other items, a song deleted from the library
//   { kind: 'video' }                  the prepared video, playing or paused (source video)
// While a video is prepared (any source), frames also carry
//   video: { state, seq, volume, position, media: { type: 'upload'|'file'|'youtube'|'vimeo'|'local', ... } }
// so screens can preload it without changing what they show.
// Every frame also carries `version` (of the live state), `eventId` (null when idle) and
//   background: { kind: 'image' | 'loop', url, dim, blur, shadow } | null
// what shows behind the text (lyrics, verse, announcement, title). Black, logo, video and
// idle frames never have one. Resolution: the live override (state.backgroundOverride: a
// media id, 'none' or null), else the item's background resolved by the server over the
// item, the song and the church default (backgrounds.items), else none (lib/backgrounds.js).
// And the corner clock (public/clock.js), on every kind of frame:
//   clock: { show, position, scale, timeZone, format } | null
// from the live state (state.clock) or, idle, the church defaults (the `clock` option);
// `show` is false on a video frame (never over a video). The screens tick it themselves.

(function (root) {
  const shared = typeof module === 'object' && module.exports;
  const { stripChords } = shared ? require('./chords.js') : root.CHORDS;
  const { normalize: normalizeClock } = shared ? require('./clock.js') : root.CLOCK;
  const DEFAULT_SAFE_MARGIN = 5; // % of each edge (lib/admin-settings.js safe_margin)

  const SOURCES = ['content', 'logo', 'black', 'video', 'translation'];
  // Sources the leader can pick (video is picked through the video commands; translation later).
  const LEADER_SOURCES = ['content', 'logo', 'black'];

  function lyricLines(content) {
    const lines = stripChords(content).split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();
    return lines;
  }

  function firstLine(text) {
    return String(text || '').split('\n').find((line) => line.trim()) || '';
  }

  // Content of the item at a position -> frame fields.
  function contentFrame(item, step, song) {
    if (!item) return { kind: 'black' };
    switch (item.type) {
      case 'song': {
        if (!item.songId || !song) return { kind: 'title', title: item.title || '' };
        const entry = song.arrangement[step];
        const section = entry && song.sections.find((s) => s.id === entry.sectionId);
        return section ? { kind: 'lyrics', lines: lyricLines(section.content) } : { kind: 'black' };
      }
      case 'verse':
        return { kind: 'verse', reference: item.reference || '', text: item.body || '' };
      case 'announcement':
        return { kind: 'announcement', title: item.title || '', body: item.body || '' };
      case 'video':
        return { kind: 'black' }; // played only through the video commands
      default:
        return { kind: 'title', title: item.title || firstLine(item.body) };
    }
  }

  // The background of the item on the projector (see above). backgrounds: { items: { itemId:
  // mediaId | null }, media: { id: { id, kind, url, dim, blur, shadow } } } or null.
  function backgroundFor(state, item, backgrounds) {
    if (!backgrounds) return null;
    const media = backgrounds.media || {};
    const pick = (id) => {
      const m = id === null || id === undefined ? null : media[id];
      return m ? { id: m.id, kind: m.kind, url: m.url, dim: m.dim, blur: m.blur, shadow: m.shadow } : null;
    };
    const override = state.backgroundOverride;
    if (override === 'none') return null;
    if (override !== null && override !== undefined) {
      const chosen = pick(override);
      if (chosen) return chosen; // a deleted override falls back to the item's own
    }
    return item ? pick((backgrounds.items || {})[item.id]) : null;
  }

  // The clock part of a frame: settings + timezone, hidden while a video plays.
  function clockFrame(clock, kind) {
    if (!clock) return null;
    const c = normalizeClock(clock);
    return { show: c.show && kind !== 'video', position: c.position, scale: c.scale, timeZone: clock.timeZone || null, format: clock.format === '12' ? '12' : '24' };
  }

  // state: live snapshot of the admin's live event, or null when none is live.
  // event: { items } of that event. songs: Map itemId -> song ready to render
  // ({ sections (transposed), arrangement: [{ sectionId }] }), at least for the current item.
  // videoMedia: how the prepared video is played ({ type, src | id, name, title }), resolved by
  // the caller (it needs the media library); null when nothing is prepared.
  // backgrounds: the event's resolved backgrounds (lib/backgrounds.js forEvent), or null.
  // clock: the church default clock (+ timeZone) for the idle screen; live frames use state.clock.
  // safeMargin: % of each edge kept free of text, logo and clock (0-12; overscan), on every frame.
  function projectorFrame(state, event, songs, { logoUrl = null, videoMedia = null, backgrounds = null, clock = null, safeMargin = DEFAULT_SAFE_MARGIN } = {}) {
    const margin = Number.isInteger(safeMargin) && safeMargin >= 0 && safeMargin <= 12 ? safeMargin : DEFAULT_SAFE_MARGIN;
    if (!state || state.status !== 'live') {
      return { kind: 'idle', logoUrl, version: state ? state.version : 0, eventId: null, background: null, clock: clockFrame(clock, 'idle'), safeMargin: margin };
    }
    const v = state.video;
    const video = v && v.state !== 'none' && videoMedia
      ? { state: v.state, seq: v.seq, volume: v.volume, position: v.position, media: videoMedia }
      : null;
    const base = { version: state.version, eventId: state.eventId, ...(video ? { video } : {}), background: null, clock: clockFrame(state.clock || null, 'other'), safeMargin: margin };
    const source = state.projector.source;
    if (source === 'black') return { kind: 'black', ...base };
    if (source === 'logo') return { kind: 'logo', logoUrl, ...base };
    if (source === 'video') {
      const kind = video && (v.state === 'playing' || v.state === 'paused') ? 'video' : 'black';
      return { kind, ...base, clock: clockFrame(state.clock || null, kind) };
    }
    if (source !== 'content') return { kind: 'black', ...base }; // translation: stage 8
    // The projector follows the worship position until an operator takes it over (stage 6).
    const pos = state.projector.follows === 'operator'
      ? { itemId: state.projector.itemId, step: state.projector.step, ended: state.projector.ended }
      : state.worship;
    // "■ Sfârșit": the item on the projector is ended -> black instead of its content until
    // the next move (the explicit Logo / black sources above still apply).
    if (pos.ended) return { kind: 'black', ...base };
    const item = (event && event.items || []).find((it) => it.id === pos.itemId);
    const content = contentFrame(item, pos.step, item && songs ? songs.get(item.id) : null);
    const background = content.kind === 'black' ? null : backgroundFor(state, item, backgrounds);
    // The next item's background, when another one, so the screens can load it ahead.
    const items = (event && event.items) || [];
    const next = item ? backgroundFor(state, items[items.indexOf(item) + 1], backgrounds) : null;
    const preload = next && (!background || next.id !== background.id) ? { nextBackground: next } : {};
    return { ...content, ...base, background, ...preload };
  }

  const FRAMES = { SOURCES, LEADER_SOURCES, DEFAULT_SAFE_MARGIN, projectorFrame, backgroundFor, lyricLines, clockFrame };

  if (typeof module === 'object' && module.exports) module.exports = FRAMES;
  else root.FRAMES = FRAMES;
})(typeof window !== 'undefined' ? window : this);
