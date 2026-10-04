'use strict';

// The time and the elapsed time in the status line of the live pages (the leader page, the
// operator console, the big lyrics view): "HH:MM · Live de hh:mm" since the event started;
// a tap on the elapsed part switches it to "pe elementul curent de mm:ss" (the time on the
// item this page drives) and back (remembered on the device). Ticks every second, changing
// only the text nodes; the clock follows the church timezone and time format the snapshot
// carries (snap.clock, public/clock.js). The event's start is server time: the offset to the
// server (snap.serverTime) keeps "Live de" right on a device whose clock is off.
//
//   const clock = LIVE_CLOCK.create(container, { t });
//   clock.update(snap, position);   // on every render; position: { itemId } this page drives
//   clock.render();                 // after a language change

(function () {
  const MODE_KEY = 'wa_live_elapsed'; // 'event' | 'item'

  function create(container, { t }) {
    const { el } = window.PAGE;
    const state = { snap: null, offset: 0, itemId: null, itemSince: null, mode: 'event', timer: null };
    try {
      if (window.localStorage.getItem(MODE_KEY) === 'item') state.mode = 'item';
    } catch (err) {
      // no storage: the event's time
    }
    const time = el('span', { class: 'live-time' });
    const elapsed = el('button', {
      type: 'button', class: 'live-elapsed', hidden: true,
      onclick: () => {
        state.mode = state.mode === 'event' ? 'item' : 'event';
        try {
          window.localStorage.setItem(MODE_KEY, state.mode);
        } catch (err) {
          // this session only
        }
        tick();
      },
    });
    container.classList.add('live-clock');
    container.replaceChildren(time, elapsed);

    const live = () => Boolean(state.snap) && state.snap.status === 'live' && Boolean(state.snap.startedAt);

    function texts() {
      const now = new Date();
      const clock = (state.snap && state.snap.clock) || {};
      const timeText = window.CLOCK.formatTime(now, clock.timeZone, clock.format);
      if (!live()) return { timeText, elapsedText: '' };
      const serverNow = now.getTime() + state.offset;
      const elapsedText = state.mode === 'item' && state.itemSince !== null
        ? t('live.clock.item', { time: window.CLOCK.formatDuration(serverNow - state.itemSince, { seconds: true }) })
        : t('live.clock.since', { time: window.CLOCK.formatDuration(serverNow - state.snap.startedAt) });
      return { timeText, elapsedText };
    }

    // Only the text nodes change: the page is never re-rendered by the clock.
    function tick() {
      const { timeText, elapsedText } = texts();
      if (time.textContent !== timeText) time.textContent = timeText;
      if (elapsed.textContent !== elapsedText) elapsed.textContent = elapsedText;
      const show = Boolean(elapsedText);
      if (elapsed.hidden === show) elapsed.hidden = !show;
    }

    function render() {
      time.setAttribute('aria-label', t('live.clock.timeLabel'));
      elapsed.setAttribute('aria-label', t('live.clock.toggle'));
      elapsed.title = t('live.clock.toggle');
      tick();
    }

    function schedule() {
      clearInterval(state.timer);
      state.timer = setInterval(tick, 1000);
    }

    return {
      update(snap, position) {
        state.snap = snap;
        if (snap && Number.isFinite(snap.serverTime)) state.offset = snap.serverTime - Date.now();
        // The item this page drives changed: its time starts now (server time).
        const itemId = live() && position ? position.itemId : null;
        if (itemId !== state.itemId) {
          state.itemId = itemId;
          state.itemSince = itemId === null ? null : Date.now() + state.offset;
        }
        if (!state.timer) schedule();
        render();
      },
      render,
    };
  }

  window.LIVE_CLOCK = { create };
})();
