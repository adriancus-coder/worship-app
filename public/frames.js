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
// Every frame also carries `version` (of the live state) and `eventId` (null when idle).

(function (root) {
  const { stripChords } = typeof module === 'object' && module.exports ? require('./chords.js') : root.CHORDS;

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

  // state: live snapshot of the admin's live event, or null when none is live.
  // event: { items } of that event. songs: Map itemId -> song ready to render
  // ({ sections (transposed), arrangement: [{ sectionId }] }), at least for the current item.
  // videoMedia: how the prepared video is played ({ type, src | id, name, title }), resolved by
  // the caller (it needs the media library); null when nothing is prepared.
  function projectorFrame(state, event, songs, { logoUrl = null, videoMedia = null } = {}) {
    if (!state || state.status !== 'live') return { kind: 'idle', logoUrl, version: state ? state.version : 0, eventId: null };
    const v = state.video;
    const video = v && v.state !== 'none' && videoMedia
      ? { state: v.state, seq: v.seq, volume: v.volume, position: v.position, media: videoMedia }
      : null;
    const base = { version: state.version, eventId: state.eventId, ...(video ? { video } : {}) };
    const source = state.projector.source;
    if (source === 'black') return { kind: 'black', ...base };
    if (source === 'logo') return { kind: 'logo', logoUrl, ...base };
    if (source === 'video') return { kind: video && (v.state === 'playing' || v.state === 'paused') ? 'video' : 'black', ...base };
    if (source !== 'content') return { kind: 'black', ...base }; // translation: stage 8
    // The projector follows the worship position until an operator takes it over (stage 6).
    const pos = state.projector.follows === 'operator'
      ? { itemId: state.projector.itemId, step: state.projector.step }
      : state.worship;
    const item = (event && event.items || []).find((it) => it.id === pos.itemId);
    return { ...contentFrame(item, pos.step, item && songs ? songs.get(item.id) : null), ...base };
  }

  const FRAMES = { SOURCES, LEADER_SOURCES, projectorFrame, lyricLines };

  if (typeof module === 'object' && module.exports) module.exports = FRAMES;
  else root.FRAMES = FRAMES;
})(typeof window !== 'undefined' ? window : this);
