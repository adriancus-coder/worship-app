'use strict';

// Song sections for the bridge worship -> SV (stage 8b). Shared by song.current (B3) and
// setlist.sections pre-translation (B4) so the content hashes always match — SV caches
// translations per hash. Chords never leave worship: only lyrics text is sent.
//
// The hash is lib/songs.lyricsHash (sha256 of the chord-stripped, whitespace-collapsed
// lyrics), so it is stable across transposition and identical to the song_sections hash.

const { createEventStore } = require('../events');
const { lyricsHash } = require('../songs');
const { stripChords } = require('../chords');

function createBridgeSections(db) {
  const events = createEventStore(db);

  // The MAIN (worship) position's song section as { title, label, text, hash }, or null when the
  // main position is not on a real song section (verse-only item, "Sfârșit", black, no item, an
  // empty section, a song deleted from the library). t labels the section in the source language.
  function currentSection(adminId, eventId, snapshot, t) {
    if (!snapshot || snapshot.status !== 'live') return null;
    const pos = snapshot.worship;
    if (!pos || !pos.itemId || pos.ended) return null;
    const ready = events.itemSong(adminId, eventId, pos.itemId, t, { scope: 'shared' });
    if (!ready) return null;
    const entry = ready.song.arrangement[pos.step];
    if (!entry) return null;
    const section = ready.song.sections.find((s) => s.id === entry.sectionId);
    if (!section) return null;
    const text = stripChords(section.content);
    if (!text.trim()) return null;
    return { title: ready.song.title || '', label: entry.label || '', text, hash: lyricsHash(section.content) };
  }

  // Every shared song section of the setlist, deduped by hash, for pre-translation (B4):
  // [{ hash, text, title, label }]. Uses the same extraction as currentSection so the hashes
  // line up with what song.current later sends.
  function setlistSections(adminId, eventId, t) {
    const found = events.get(adminId, eventId, { scope: 'shared', t });
    if (!found) return [];
    const out = [];
    const seen = new Set();
    for (const item of found.items) {
      if (item.type !== 'song' || !item.songId) continue;
      const ready = events.itemSong(adminId, eventId, item.id, t, { scope: 'shared' });
      if (!ready) continue;
      for (const entry of ready.song.arrangement) {
        const section = ready.song.sections.find((s) => s.id === entry.sectionId);
        if (!section) continue;
        const text = stripChords(section.content);
        if (!text.trim()) continue;
        const hash = lyricsHash(section.content);
        if (seen.has(hash)) continue;
        seen.add(hash);
        out.push({ hash, text, title: ready.song.title || '', label: entry.label || '' });
      }
    }
    return out;
  }

  return { currentSection, setlistSections };
}

module.exports = { createBridgeSections };
