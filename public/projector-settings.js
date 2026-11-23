'use strict';

// "Setări proiector" on the live page and the operator console: the projector panel's
// one-time choices (background, clock, key, chords, "Așteaptă strofa", video) fold under one
// row, so during the service only what is used every minute stays in view (the preview and
// Cântare / Logo / Negru). The row says what is on ("Ceas ↘ · Acorduri · Așteaptă strofa").
// Open / closed is kept on the device. A video that is prepared or started opens the row
// once (its Play / Stop must stay reachable); the keys K, G, C work either way.
//
//   const settings = PROJECTOR_SETTINGS.mount(details, { t, el });
//   settings.update(snap);     // the live snapshot (clock, songKey, chords, awaitSection, video)
//   settings.render();         // after a language change

(function () {
  const STORE_KEY = 'wa_projector_settings';
  const ARROWS = { 'top-left': '↖', 'top-right': '↗', 'bottom-left': '↙', 'bottom-right': '↘' };
  const VIDEO_ON = ['prepared', 'playing', 'paused'];

  function mount(details, { t, el }) {
    let snap = null;
    let videoSeq = null; // the video already opened for
    const title = el('span', { class: 'projector-settings-title' });
    const state = el('span', { class: 'projector-settings-state' });
    const summary = el('summary', { class: 'projector-settings-row' }, title, state);
    details.prepend(summary);
    details.classList.add('projector-settings');
    try { details.open = localStorage.getItem(STORE_KEY) === 'open'; } catch (err) { details.open = false; }
    details.addEventListener('toggle', () => {
      try { localStorage.setItem(STORE_KEY, details.open ? 'open' : 'closed'); } catch (err) { /* this page only */ }
    });

    function parts() {
      if (!snap) return [];
      const list = [];
      if (snap.clock && snap.clock.show) list.push(`${t('live.projector.clock')} ${ARROWS[snap.clock.position] || ''}`.trim());
      if (snap.songKey && snap.songKey.show) list.push(`${t('live.projector.key')} ${ARROWS[snap.songKey.position] || ''}`.trim());
      if (snap.chords && snap.chords.show) list.push(t('live.projector.chords'));
      if (snap.awaitSection && snap.awaitSection.on) list.push(t('live.projector.await'));
      if (snap.video && VIDEO_ON.includes(snap.video.state)) list.push(t('video.heading'));
      return list;
    }

    function render() {
      title.textContent = t('live.projector.settings');
      const on = parts();
      state.textContent = on.length ? on.join(' · ') : t('live.projector.settingsHint');
      state.classList.toggle('is-on', on.length > 0);
      summary.setAttribute('aria-label', `${t('live.projector.settings')}: ${state.textContent}`);
    }

    render();
    document.addEventListener('i18n:change', render);
    return {
      update(next) {
        snap = next || null;
        const video = snap && snap.video;
        if (video && VIDEO_ON.includes(video.state) && video.seq !== videoSeq) {
          videoSeq = video.seq;
          if (!details.open) details.open = true; // the toggle event keeps it on the device
        }
        render();
      },
      render,
    };
  }

  window.PROJECTOR_SETTINGS = { mount };
})();
