'use strict';

// "The song as on the home card", for any page that lists a programme's songs (the home
// card, the event page): the whole song under its row (every section once, in the event's
// order, chords transposed for the event; GET /api/events/:id/items/:itemId/song, once
// each) and, from a section, "⤢ Versuri mari" (public/big-lyrics.js, members-style, its own
// place): swipes / ← → step through the song and on into the next song of the programme,
// "Toată cântarea" inside it lists the sections again; ✕ returns to the page.
//
//   const songs = PROGRAMME_BIG.create({ api, eventId, items, onItemChange })
//     eventId()          -> the programme's event id (the home card's event can change)
//     items()            -> the programme's song items, in order ({ id, songId, title, ... })
//     onItemChange(id)   -> the big view moved into another song (the page opens that row)
//   songs.box(it)        -> element: the song under its row (loading / error / the sections;
//                           a tap on a section opens the big view there)
//   songs.sections(it, { hint })  -> the same sections alone, for a page's own box
//   songs.load(it)       -> promise of the song (cached); songs.song(it) -> the settled one
//   songs.open(it, sectionId)     -> the big view at that section of that song
//   songs.openFirst()    -> the big view at the first song (an entry point before the start)
//   songs.close()        -> closes the big view (the event went live: the live view takes over)
//   songs.update()       -> after the items changed (the big view re-reads them)

(function () {
  const TEXT_ONLY_KEY = 'wa_text_only'; // the same choice as the song page

  function create({ api, eventId, items, onItemChange = () => {} }) {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const cache = new Map(); // item id -> promise of the song
    const settled = {}; // item id -> the song (or null), for a synchronous render
    const pos = { itemId: null, step: 0 }; // the big view's own place

    const textOnly = () => { try { return window.localStorage.getItem(TEXT_ONLY_KEY) === '1'; } catch (err) { return false; } };

    function load(it) {
      if (!cache.has(it.id)) {
        const promise = api(`/api/events/${eventId()}/items/${it.id}/song`)
          .then((res) => (res.ok ? res.body.song : null)).catch(() => null)
          .then((song) => { settled[it.id] = song; return song; });
        cache.set(it.id, promise);
      }
      return cache.get(it.id);
    }
    const song = (it) => settled[it.id];

    // the sections in order of first appearance in the arrangement; labels from the whole song
    function orderOf(s) {
      const order = [];
      for (const { sectionId } of s.arrangement || []) {
        const index = s.sections.findIndex((x) => x.id === sectionId);
        if (index >= 0 && !order.includes(index)) order.push(index);
      }
      if (!order.length) s.sections.forEach((x, i) => order.push(i));
      return order;
    }
    const stepsOf = (s) => ((s && s.arrangement && s.arrangement.length) ? s.arrangement : (s ? s.sections.map((x, i) => ({ sectionId: x.id, code: '', label: String(i + 1) })) : []));

    // The sections of a loaded song, each a tap target for the big view.
    function sections(it, { hint = true } = {}) {
      const s = song(it);
      if (s === undefined) return [el('p', { class: 'muted', text: t('events.loading') })];
      if (!s) return [el('p', { class: 'message error', text: t('common.networkError') })];
      const labels = window.SECTIONS.sectionLabels(s.sections, t);
      const order = orderOf(s);
      return [
        hint ? el('p', { class: 'hint now-song-hint', text: t('home.sectionHint') }) : null,
        el('div', { class: 'now-song-sections', onclick: (event) => {
          const section = event.target.closest('.song-section');
          if (!section) return;
          const index = [...section.parentNode.children].filter((n) => n.classList.contains('song-section')).indexOf(section);
          open(it, s.sections[order[index]].id);
        } }, ...window.SONG_RENDER.sectionsView(order.map((i) => s.sections[i]), { textOnly: textOnly(), headingLevel: 3, labels: order.map((i) => labels[i]) })),
      ].filter(Boolean);
    }
    function box(it) {
      const node = el('div', { class: 'now-song', id: `now-song-${it.id}` }, ...sections(it));
      if (song(it) === undefined) load(it);
      return node;
    }

    // --- "⤢ Versuri mari" from a section ------------------------------------------------
    // the big view reads the steps from item.arrangementResolved: the loaded song's arrangement
    const bigItems = () => items().map((it) => (settled[it.id] ? { ...it, arrangementResolved: settled[it.id].arrangement } : it));
    async function open(it, sectionId) {
      const s = await load(it);
      if (!s) return;
      const step = Math.max(0, stepsOf(s).findIndex((a) => a.sectionId === sectionId));
      Object.assign(pos, { itemId: it.id, step });
      big.update(null, bigItems());
      big.open();
    }
    // the neighbour place: the next / previous step, then the next / previous song (step 0 / last)
    async function neighbour(delta) {
      const list = items();
      const index = list.findIndex((x) => x.id === pos.itemId);
      if (index < 0) return null;
      const current = await load(list[index]);
      const count = stepsOf(current).length;
      if (delta > 0 && pos.step + 1 < count) return { itemId: pos.itemId, step: pos.step + 1 };
      if (delta < 0 && pos.step > 0) return { itemId: pos.itemId, step: pos.step - 1 };
      const other = list[index + delta];
      if (!other) return null;
      const s = await load(other);
      return { itemId: other.id, step: delta > 0 ? 0 : Math.max(0, stepsOf(s).length - 1) };
    }
    async function move(delta) {
      const to = await neighbour(delta);
      if (!to) return;
      goTo(to);
    }
    function goTo(to) {
      const changed = to.itemId !== pos.itemId;
      Object.assign(pos, to);
      if (changed) onItemChange(to.itemId);
      big.update(null, bigItems());
    }
    const canMove = (delta) => {
      const list = items();
      const index = list.findIndex((x) => x.id === pos.itemId);
      if (index < 0) return false;
      const current = settled[pos.itemId];
      const count = current ? stepsOf(current).length : 1;
      return delta > 0 ? (pos.step + 1 < count || index + 1 < list.length) : (pos.step > 0 || index > 0);
    };
    const big = window.BIG_LYRICS.create({
      api, eventId: null, standalone: true, loadSong: load,
      position: () => (pos.itemId ? pos : null),
      commands: { prev: () => move(-1), next: () => move(1), goTo },
      member: { nav: () => ({ show: true, away: false, canPrev: canMove(-1), canNext: canMove(1) }), backToLive: () => {} },
    });

    // openFirst(): the big view at the first song's first section (an entry point before the start)
    async function openFirst() {
      const first = items()[0];
      if (!first) return;
      const s = await load(first);
      if (s) open(first, (stepsOf(s)[0] || {}).sectionId);
    }
    return { box, sections, load, song, open, openFirst, update: () => big.update(null, bigItems()), isOpen: () => big.isOpen(), close: () => big.close() };
  }

  window.PROGRAMME_BIG = { create };
})();
