'use strict';

// Video controls for the projector (the leader live page now; the operator console in
// stage 6). Tabs Bibliotecă / URL / Stick USB to prepare a video, the prepared video's
// status and progress, "De la început", volume, and one big "Pornește pe proiector" /
// "Pauză" button. Preparing never changes what the projector shows.
//
//   const panel = VIDEO_PANEL.create(container, { send, api, t, el, canAddUrl });
//   panel.setSetlist(items); panel.update(liveSnapshot); panel.status(videoStatus);
//   panel.setScreens(count); panel.setLocked(locked);
// canAddUrl: false hides the URL tab (it adds to the media library: owner / leader only).
// setLocked(true) disables every control (the operator console while worship has the projector).
// send(type, extra) sends a live command; api(url, options) is PAGE.api.

(function () {
  const TABS = ['library', 'url', 'usb'];

  function time(seconds) {
    if (!Number.isFinite(seconds)) return '–:––';
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function create(container, { send, api, t, el, canAddUrl = true }) {
    const tabNames = canAddUrl ? TABS : TABS.filter((tab) => tab !== 'url');
    const state = { tab: 'library', media: [], items: [], snap: null, statuses: new Map(), status: null, screens: 0, message: '', locked: false };

    // Several screens may report: any screen blocked by autoplay or failing to load is shown;
    // otherwise the furthest progress counts.
    function combined() {
      const all = [...state.statuses.values()];
      if (!all.length) return null;
      return all.find((s) => s.error === 'autoplay') || all.find((s) => s.error === 'load')
        || all.reduce((a, b) => (b.position > a.position ? b : a));
    }
    const root = el('section', { class: 'video-panel', 'aria-labelledby': 'video-heading' });
    container.replaceChildren(root);

    async function loadMedia() {
      const res = await api('/api/media');
      state.media = res.ok ? res.body.media : [];
      render();
    }

    function preparedTitle(video) {
      if (!video || video.state === 'none') return '';
      if (video.local) return video.localName || t('video.localWaitingName');
      if (video.mediaId) {
        const found = state.media.find((m) => m.id === video.mediaId);
        return found ? found.title : t('video.untitled');
      }
      const item = state.items.find((it) => it.id === video.itemId);
      return item ? item.title || t('setlist.types.video') : t('video.untitled');
    }

    function statusText(video, live) {
      const status = state.status;
      if (!live) return t('video.notLive');
      if (!video || video.state === 'none') return t('video.nothingPrepared');
      if (!state.screens) return t('video.noScreens');
      if (status && status.error === 'autoplay' && video.state === 'playing') return t('video.autoplayBlocked');
      if (status && status.error === 'load') return t('video.loadError');
      if (video.local && !video.localName) return t('video.localWaiting');
      return t(`video.state.${video.state}`);
    }

    function prepareButton(label, extra) {
      return el('button', { type: 'button', class: 'secondary', text: t('video.prepare'), 'aria-label': t('video.prepareLabel', { title: label }), onclick: () => send('video.prepare', extra) });
    }

    function tabPanel() {
      if (state.tab === 'library') {
        const fromSetlist = state.items.filter((it) => it.type === 'video' && (it.mediaId || it.url));
        const rows = [
          ...fromSetlist.map((it) => el('li', { class: 'video-row' },
            el('span', { class: 'video-row-text' }, el('span', { class: 'video-row-title', text: it.title || t('setlist.types.video') }), el('span', { class: 'video-row-meta', text: t('video.fromSetlist') })),
            prepareButton(it.title || '', it.mediaId ? { mediaId: it.mediaId } : { itemId: it.id }))),
          ...state.media.map((m) => el('li', { class: 'video-row' },
            el('span', { class: 'video-row-text' }, el('span', { class: 'video-row-title', text: m.title }), el('span', { class: 'video-row-meta', text: t(`video.types.${m.source.type}`) })),
            prepareButton(m.title, { mediaId: m.id }))),
        ];
        return rows.length ? el('ul', { class: 'video-list' }, rows) : el('p', { class: 'muted', text: t('video.libraryEmpty') });
      }
      if (state.tab === 'url') {
        const title = el('input', { type: 'text', id: 'video-url-title', maxlength: '120', placeholder: t('media.titleLabel') });
        const url = el('input', { type: 'url', id: 'video-url', maxlength: '500', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false', placeholder: 'https://…' });
        const form = el('form', {
          class: 'video-url-form',
          novalidate: true,
          onsubmit: async (event) => {
            event.preventDefault();
            const res = await api('/api/media/url', { method: 'POST', body: { title: title.value || url.value, url: url.value } });
            if (!res.ok) {
              state.message = res.body.error || t('common.networkError');
              render();
              return;
            }
            state.media = [...state.media, res.body.media];
            state.message = '';
            send('video.prepare', { mediaId: res.body.media.id });
          },
        },
        el('label', { for: 'video-url', class: 'sr-only', text: t('media.urlLabel') }), url,
        el('label', { for: 'video-url-title', class: 'sr-only', text: t('media.titleLabel') }), title,
        el('button', { type: 'submit', class: 'secondary', text: t('video.prepare') }));
        return el('div', null, el('p', { class: 'hint', text: t('media.urlHint') }), form);
      }
      return el('div', null,
        el('p', { class: 'hint', text: t('video.usbHint') }),
        el('button', { type: 'button', class: 'secondary', text: t('video.usbPrepare'), onclick: () => send('video.prepare', { local: true }) }));
    }

    // Progress and status text only (status reports arrive every second; the rest of the
    // panel, e.g. a volume slider being dragged, is left alone).
    function refreshStatus() {
      const snap = state.snap;
      const video = snap ? snap.video : null;
      const text = root.querySelector('#video-status-text');
      if (text) text.textContent = statusText(video, Boolean(snap) && snap.status === 'live');
      const bar = root.querySelector('.video-progress progress');
      const label = root.querySelector('.video-time');
      if (!bar || !label || !video) return;
      const playing = video.state === 'playing' && snap.projector.source === 'video';
      const position = playing && state.status ? state.status.position : video.position;
      const duration = state.status ? state.status.duration : null;
      bar.max = String(duration || 1);
      bar.value = String(Math.min(position || 0, duration || 1));
      label.textContent = `${time(position)} / ${time(duration)}`;
    }

    function render() {
      const focusedId = root.contains(document.activeElement) ? document.activeElement.id : null;
      const snap = state.snap;
      const live = Boolean(snap) && snap.status === 'live';
      const video = snap ? snap.video : null;
      const loaded = video && video.state !== 'none';
      const playing = loaded && video.state === 'playing' && snap.projector.source === 'video';
      const status = state.status;
      const position = playing && status ? status.position : (video ? video.position : 0);
      const duration = status ? status.duration : null;

      const tabs = el('div', { class: 'video-tabs', role: 'tablist', 'aria-label': t('video.tabsLabel') },
        tabNames.map((tab) => el('button', {
          type: 'button',
          role: 'tab',
          id: `video-tab-${tab}`,
          'aria-selected': String(state.tab === tab),
          'aria-controls': 'video-tab-panel',
          class: 'video-tab',
          text: t(`video.tabs.${tab}`),
          onclick: () => {
            state.tab = tab;
            render();
          },
        })));

      root.replaceChildren(...[
        el('h3', { id: 'video-heading', text: t('video.heading') }),
        tabs,
        el('div', { id: 'video-tab-panel', role: 'tabpanel', 'aria-labelledby': `video-tab-${state.tab}`, class: 'video-tab-panel' }, live ? tabPanel() : el('p', { class: 'muted', text: t('video.notLive') })),
        state.message ? el('p', { class: 'message error', role: 'alert', text: state.message }) : null,
        el('div', { class: `video-status${loaded ? ' loaded' : ''}` },
          loaded ? el('p', { class: 'video-status-title', text: preparedTitle(video) }) : null,
          el('p', { class: 'video-status-text', id: 'video-status-text', role: 'status', 'aria-live': 'polite', text: statusText(video, live) }),
          loaded ? el('div', { class: 'video-progress' },
            el('progress', { max: String(duration || 1), value: String(Math.min(position || 0, duration || 1)), 'aria-label': t('video.progress') }),
            el('span', { class: 'video-time', text: `${time(position)} / ${time(duration)}` })) : null),
        el('button', {
          type: 'button',
          id: 'video-toggle',
          class: `video-toggle${playing ? ' playing' : ''}`,
          disabled: !live || !loaded || (video.local && !video.localName),
          text: playing ? t('video.pause') : t('video.play'),
          onclick: () => send(playing ? 'video.pause' : 'video.play'),
        }),
        el('div', { class: 'video-tools' },
          el('button', { type: 'button', class: 'secondary', id: 'video-restart', disabled: !live || !loaded, text: t('video.restart'), onclick: () => send('video.restart') }),
          el('button', { type: 'button', class: 'secondary', id: 'video-stop', disabled: !live || !loaded, text: t('video.stop'), onclick: () => send('video.stop') }),
          el('label', { class: 'video-volume' },
            el('span', { text: t('video.volume') }),
            el('input', {
              type: 'range', id: 'video-volume', min: '0', max: '1', step: '0.05', value: String(video ? video.volume : 1), disabled: !live,
              onchange: (event) => send('video.volume', { volume: Number(event.target.value) }),
            }))),
      ].filter(Boolean)); // a null would be inserted as the text "null"
      if (state.locked) {
        for (const control of root.querySelectorAll('button:not([role="tab"]), input, select')) control.disabled = true;
      }
      if (focusedId) {
        const again = root.querySelector(`#${focusedId}`);
        if (again && !again.disabled) again.focus();
      }
    }

    loadMedia().catch(() => {});

    return {
      setSetlist(items) {
        state.items = items || [];
        render();
      },
      update(snap) {
        if (state.snap && snap && state.snap.video && snap.video && state.snap.video.seq !== snap.video.seq) {
          state.statuses.clear(); // a new video or a restart: old reports no longer apply
          state.status = null;
        }
        state.snap = snap;
        render();
      },
      // One screen's report, or a list (when the panel starts watching).
      status(status) {
        const before = state.status && state.status.error;
        for (const s of Array.isArray(status) ? status : [status]) {
          if (s && s.screenId !== undefined) state.statuses.set(s.screenId, s);
        }
        state.status = combined();
        if ((state.status && state.status.error) !== before) render();
        else refreshStatus();
      },
      setScreens(count) {
        state.screens = count;
        render();
      },
      setLocked(locked) {
        if (state.locked === Boolean(locked)) return;
        state.locked = Boolean(locked);
        render();
      },
      reloadMedia: loadMedia,
      render,
    };
  }

  window.VIDEO_PANEL = { create, time };
})();
