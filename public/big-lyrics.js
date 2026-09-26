'use strict';

// "⤢ Versuri mari": a full-screen lyrics view for whoever leads (the leader live page and
// the operator console). The current section's lyrics, large (auto-fitted like the
// projector) with the chords ABOVE the lines in the reader's notation ("Doar text" hides
// them), the section label on top and the next section's first line small at the bottom.
// The bottom bar sends the SAME live commands as the page (prev / next / "■ Sfârșit"): the
// projector and the team follow per mode; the view follows live updates too (if the other
// person moves, this moves). Swipe left / right = next / prev; keys ← → Space E B as on the
// page, F / Escape / ✕ close. A− / A+ scale the fitted size (saved). Wake lock while open.
//
//   const big = BIG_LYRICS.create({ api, eventId, position, commands, connection, drivesProjector })
//     position()          -> { itemId, step, ended } this page drives (null: nothing)
//     commands            { prev(), next(), end(), toggleBlack() } (the page's own)
//     connection()        -> the page's connection state; drivesProjector() -> true when the
//                            position is the projector's (the console in split mode)
//   big.open()            // from the current step, the button or key F
//   big.update(snap, items)   // on every render: follows live; closed views ignore it
//   big.isOpen()

(function () {
  const SCALE_KEY = 'wa_big_scale';
  const TEXT_ONLY_KEY = 'wa_text_only'; // the same choice as the song, rehearsal and follow pages
  const SCALE = { min: 0.6, max: 1.6, step: 0.1 };
  const SWIPE_PX = 50;
  const MIN_FONT = 0.02; // of the box height, like the projector
  const MAX_FONT = 0.14;

  function stored(key, fallback) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (err) {
      return fallback;
    }
  }
  function store(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      // no storage: this session only
    }
  }

  function create({ api, eventId, position, commands, connection, drivesProjector = () => false }) {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const state = { snap: null, items: [], scale: Number(stored(SCALE_KEY, '1')) || 1, textOnly: stored(TEXT_ONLY_KEY, '0') === '1', songs: new Map(), setlistKey: null, renderId: 0 };
    let dialog = null;
    let wakeLock = null;

    // A song item ready to render (sections transposed, arrangement resolved), once each.
    function loadSong(item) {
      if (!state.songs.has(item.id)) {
        state.songs.set(item.id, api(`/api/events/${eventId}/items/${item.id}/song`)
          .then((res) => (res.ok ? res.body.song : null)).catch(() => null));
      }
      return state.songs.get(item.id);
    }

    function itemTitle(item) {
      if (item.type === 'song') return item.title || t('setlist.songDeleted');
      if (item.type === 'verse') return item.reference || t('setlist.types.verse');
      return item.title || (item.body ? item.body.split('\n')[0].slice(0, 80) : '') || t(`setlist.types.${item.type}`);
    }

    // --- the dialog -----------------------------------------------------------------

    const parts = {};
    function build() {
      parts.label = el('p', { class: 'big-label' });
      parts.text = el('div', { class: 'big-text' });
      parts.next = el('p', { class: 'big-next' });
      parts.body = el('div', { class: 'big-body' }, parts.text);
      parts.status = el('p', { class: 'big-status', role: 'status', 'aria-live': 'polite' });
      parts.textOnly = el('button', { type: 'button', class: 'secondary big-tool', 'aria-pressed': 'false', onclick: () => setTextOnly(!state.textOnly) });
      parts.smaller = el('button', { type: 'button', class: 'secondary big-tool', text: 'A−', onclick: () => setScale(-SCALE.step) });
      parts.larger = el('button', { type: 'button', class: 'secondary big-tool', text: 'A+', onclick: () => setScale(SCALE.step) });
      parts.close = el('button', { type: 'button', class: 'secondary big-tool big-close', 'data-icon': 'close', onclick: close });
      parts.prev = el('button', { type: 'button', class: 'secondary', 'data-icon': 'undo', onclick: () => commands.prev() });
      parts.end = el('button', { type: 'button', class: 'secondary end-item', 'aria-keyshortcuts': 'E', onclick: () => commands.end() });
      parts.nextButton = el('button', { type: 'button', onclick: () => commands.next() });
      dialog = el('dialog', { class: 'big-lyrics', 'aria-label': t('big.title') },
        el('div', { class: 'big-top' }, parts.label, el('span', { class: 'big-tools' }, parts.textOnly, parts.smaller, parts.larger, parts.close)),
        parts.body,
        parts.next,
        parts.status,
        el('div', { class: 'big-nav', role: 'group', 'aria-label': t('live.navLabel') }, parts.prev, parts.end, parts.nextButton));
      dialog.addEventListener('close', () => { releaseWake(); });
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); }); // Escape
      dialog.addEventListener('keydown', onKey);
      // A horizontal swipe on the text: next / prev.
      let swipe = null;
      parts.body.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse') return;
        swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
      });
      parts.body.addEventListener('pointerup', (event) => {
        if (!swipe || swipe.id !== event.pointerId) return;
        const dx = event.clientX - swipe.x;
        const dy = event.clientY - swipe.y;
        swipe = null;
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? commands.next : commands.prev)();
      });
      parts.body.addEventListener('pointercancel', () => { swipe = null; });
      window.addEventListener('resize', () => { if (isOpen()) fit(); });
      document.body.append(dialog);
    }

    function onKey(event) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === ' ' && event.target.closest('button')) return; // Space clicks the focused button
      const keys = {
        ArrowRight: commands.next, ' ': commands.next, ArrowLeft: commands.prev,
        e: () => { if (!parts.end.disabled) commands.end(); },
        b: commands.toggleBlack,
        f: close,
      };
      const action = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    }

    function isOpen() {
      return Boolean(dialog && dialog.open);
    }

    function open() {
      if (!dialog) build();
      if (dialog.open) return;
      dialog.showModal();
      render();
      keepScreenOn();
      parts.nextButton.focus();
    }

    function close() {
      if (dialog && dialog.open) dialog.close();
    }

    // --- wake lock -------------------------------------------------------------------

    async function keepScreenOn() {
      if (!('wakeLock' in navigator) || !isOpen() || document.visibilityState !== 'visible' || (wakeLock && !wakeLock.released)) return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
      } catch (err) {
        // refused: the screen may dim
      }
    }
    function releaseWake() {
      if (wakeLock && !wakeLock.released) wakeLock.release().catch(() => {});
      wakeLock = null;
    }
    document.addEventListener('visibilitychange', () => { if (isOpen()) keepScreenOn(); });

    // --- settings ---------------------------------------------------------------------

    function setScale(delta) {
      state.scale = Math.min(SCALE.max, Math.max(SCALE.min, Math.round((state.scale + delta) * 10) / 10));
      store(SCALE_KEY, String(state.scale));
      fit();
      parts.smaller.disabled = state.scale <= SCALE.min + 1e-9;
      parts.larger.disabled = state.scale >= SCALE.max - 1e-9;
    }

    function setTextOnly(value) {
      state.textOnly = value;
      store(TEXT_ONLY_KEY, value ? '1' : '0');
      render();
    }

    // The largest font size at which the text fits the body, then the user's A−/A+ factor.
    function fit() {
      const box = parts.text;
      const cs = getComputedStyle(parts.body);
      const height = parts.body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const width = parts.body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (!(height > 0) || !(width > 0)) return;
      let lo = Math.max(8, height * MIN_FONT);
      let hi = Math.max(lo, height * MAX_FONT);
      // The chord sheet scrolls on its own (overflow-x: auto), so its overflow is measured too.
      const widest = () => Math.max(box.scrollWidth, ...[...box.querySelectorAll('.chord-sheet')].map((sheet) => sheet.scrollWidth));
      const fits = () => widest() <= width && box.scrollHeight <= height;
      box.style.fontSize = `${hi}px`;
      if (!fits()) {
        for (let i = 0; i < 18 && hi - lo > 0.5; i++) {
          const mid = (lo + hi) / 2;
          box.style.fontSize = `${mid}px`;
          if (fits()) lo = mid;
          else hi = mid;
        }
      } else {
        lo = hi;
      }
      box.style.fontSize = `${Math.max(8, lo * state.scale)}px`;
      dialog.classList.toggle('scrolls', box.scrollHeight > height + 1);
    }

    // --- rendering ---------------------------------------------------------------------

    function update(snap, items) {
      state.snap = snap;
      state.items = items || [];
      if (snap && snap.setlistKey !== state.setlistKey) {
        state.setlistKey = snap.setlistKey;
        state.songs.clear();
      }
      if (isOpen()) render();
    }

    // Connection · mode · in split mode where the other one is (the team when this page
    // drives the projector, the projector otherwise).
    function statusLine() {
      const snap = state.snap;
      const value = connection ? connection() : 'connected';
      const bits = [t(`live.modes.${snap.mode === 'split' ? 'split' : 'together'}`)];
      if (snap.mode === 'split') {
        const projector = drivesProjector();
        const at = projector ? snap.worship : { itemId: snap.projector.itemId, step: snap.projector.step };
        const item = state.items.find((it) => it.id === at.itemId);
        const label = item ? [itemTitle(item), item.arrangementResolved && item.arrangementResolved[at.step] ? item.arrangementResolved[at.step].label : null].filter(Boolean).join(' · ') : '—';
        bits.push(t(projector ? 'live.modes.teamAt' : 'live.modes.projectorAt', { label }));
      }
      return { value, conn: t(`live.connection.${value}`), text: bits.join(' · ') };
    }

    async function render() {
      if (!isOpen() || !state.snap) return;
      const renderId = ++state.renderId;
      const snap = state.snap;
      const pos = position();
      const item = pos && state.items.find((it) => it.id === pos.itemId);
      parts.textOnly.textContent = t('song.textOnly');
      parts.textOnly.setAttribute('aria-pressed', String(state.textOnly));
      parts.close.setAttribute('aria-label', t('big.close'));
      parts.smaller.setAttribute('aria-label', t('big.smaller'));
      parts.larger.setAttribute('aria-label', t('big.larger'));
      parts.smaller.disabled = state.scale <= SCALE.min + 1e-9;
      parts.larger.disabled = state.scale >= SCALE.max - 1e-9;
      parts.prev.textContent = t('live.prev');
      const { value, conn, text } = statusLine();
      parts.status.replaceChildren(el('span', { class: 'big-dot', 'data-state': value, 'aria-hidden': 'true' }), `${conn} · ${text}`);
      if (!item || snap.status !== 'live') {
        parts.label.textContent = '';
        parts.text.replaceChildren(el('p', { class: 'big-lines', text: t('setlist.empty') }));
        parts.next.textContent = '';
        parts.prev.disabled = parts.end.disabled = parts.nextButton.disabled = true;
        return;
      }
      const index = state.items.indexOf(item);
      const steps = item.type === 'song' && item.songId && item.arrangementResolved ? item.arrangementResolved : null;
      const step = steps ? steps[pos.step] : null;
      const following = state.items[index + 1];
      // The label after this step: the next section, else the next item.
      let after = null;
      if (pos.ended) after = following ? { label: itemTitle(following), item: following } : null;
      else if (steps && pos.step + 1 < steps.length) after = { label: steps[pos.step + 1].label, item, step: pos.step + 1 };
      else after = following ? { label: itemTitle(following), item: following } : null;
      parts.prev.disabled = index === 0 && pos.step === 0 && !pos.ended;
      parts.nextButton.disabled = !after;
      parts.nextButton.textContent = after ? t('live.next', { label: after.label }) : t('live.nextEnd');
      window.LIVE.renderEndButton(parts.end, { ended: Boolean(pos.ended), hasItem: true });
      parts.label.textContent = step ? `${itemTitle(item)} · ${step.label}` : itemTitle(item);

      if (pos.ended) {
        parts.text.replaceChildren(el('p', { class: 'big-lines big-ended', text: t(item.type === 'song' ? 'follow.songEnded' : 'follow.itemEnded') }));
      } else if (!steps) {
        const lines = String(item.body || '').split('\n');
        parts.text.replaceChildren(el('div', { class: 'big-lines' }, lines.map((line) => el('div', { class: 'lyric-line', text: line || ' ' }))));
      } else {
        const song = await loadSong(item);
        if (renderId !== state.renderId) return;
        const entry = song && song.arrangement[pos.step];
        const sectionIndex = entry ? song.sections.findIndex((s) => s.id === entry.sectionId) : -1;
        if (sectionIndex < 0) {
          parts.text.replaceChildren(el('p', { class: 'big-lines', text: t('common.networkError') }));
        } else {
          const view = window.SONG_RENDER.sectionsView([song.sections[sectionIndex]], { textOnly: state.textOnly, headingLevel: 3 });
          const section = view[0];
          section.querySelector('.section-label').remove(); // the label is on top already
          parts.text.replaceChildren(section);
        }
      }
      // The next section's first line, small.
      let firstLine = '';
      if (after && after.item === item && steps && steps[after.step]) firstLine = steps[after.step].firstLine || '';
      parts.next.textContent = after ? `${t('live.upNext')} ${after.label}${firstLine ? ` — ${firstLine}` : ''}` : t('live.nothingAfter');
      fit();
    }

    document.addEventListener('notation:change', () => { if (isOpen()) render(); });
    document.addEventListener('i18n:change', () => { if (isOpen()) render(); });

    return { open, close, isOpen, update };
  }

  window.BIG_LYRICS = { create };
})();
