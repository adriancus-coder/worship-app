'use strict';

// The operator's proposals on the leader's live page. A new proposal shows a small toast
// (top right, never in the way of the live controls) with "Mai târziu" and "Vezi"; the
// pending count stays as a badge next to the setlist heading, which reopens the list.
// "Vezi" opens the proposal in a dialog (the only moment the live controls are covered):
// key, sections with chords in the user's notation, where to add it, Refuză / Adaugă.
//
//   const requests = LIVE_REQUESTS.create({ badge, toast, dialog, eventId, api, send, t, el });
//   requests.update(snapshot);  // snapshots of owner / leader carry `requests` and `items`

(function () {
  function create({ badge, toast, dialog, eventId, api, send, t, el }) {
    const state = { snap: null, seen: null, toastFor: null, open: null, message: '' };

    const pending = () => ((state.snap && state.snap.requests) || []).filter((r) => r.status === 'pending');
    const itemOf = (id) => ((state.snap && state.snap.items) || []).find((it) => it.id === id) || null;
    const keyText = (key) => (key ? t('rehearse.key', { key: window.NOTATION ? window.NOTATION.chord(key) : key }) : '');

    function kindText(request) {
      return t(`live.requests.proposes.${['song', 'verse', 'announcement'].includes(request.type) ? request.type : 'other'}`);
    }

    // --- badge and toast --------------------------------------------------------------

    function renderBadge() {
      const n = pending().length;
      badge.hidden = n === 0;
      badge.textContent = String(n);
      badge.setAttribute('aria-label', t('live.requests.badgeLabel', { n }));
      badge.title = t('live.requests.badgeLabel', { n });
    }

    function renderToast() {
      const request = pending().find((r) => r.itemId === state.toastFor);
      if (!request) {
        toast.hidden = true;
        toast.replaceChildren();
        return;
      }
      toast.hidden = false;
      toast.replaceChildren(
        el('p', { class: 'toast-text' },
          el('strong', { text: kindText(request) }),
          el('span', { text: ` · ${request.title}` }),
          request.key ? el('span', { text: ` · ${keyText(request.key)}` }) : null),
        el('div', { class: 'toast-actions' },
          el('button', { type: 'button', class: 'secondary', text: t('live.requests.later'), onclick: () => { state.toastFor = null; renderToast(); } }),
          el('button', { type: 'button', text: t('live.requests.view'), onclick: () => openRequest(request.itemId) })));
    }

    // --- the dialog: the list, or one proposal -------------------------------------------

    function close() {
      state.open = null;
      state.message = '';
      if (dialog.open) dialog.close();
    }

    function openList() {
      state.open = { list: true };
      state.toastFor = null;
      renderToast();
      renderDialog();
      if (!dialog.open) dialog.showModal();
    }

    async function openRequest(itemId) {
      state.toastFor = null;
      renderToast();
      state.open = { itemId, song: null, loading: true, position: 'afterCurrent' };
      renderDialog();
      if (!dialog.open) dialog.showModal();
      const item = itemOf(itemId);
      if (item && item.type === 'song' && item.songId) {
        const res = await api(`/api/events/${eventId}/items/${itemId}/song`).catch(() => null);
        if (!state.open || state.open.itemId !== itemId) return;
        state.open.song = res && res.ok ? res.body.song : null;
      }
      if (state.open && state.open.itemId === itemId) {
        state.open.loading = false;
        renderDialog();
      }
    }

    async function answer(itemId, accept) {
      const position = state.open && state.open.position;
      const reply = accept
        ? await send('request.accept', { itemId, position })
        : await send('request.refuse', { itemId });
      if (reply && reply.ok) {
        close();
        return;
      }
      state.message = (reply && reply.error) || t('common.networkError');
      renderDialog();
    }

    function preview(item, song) {
      if (song) {
        const labels = window.SECTIONS.sectionLabels(song.sections, t);
        return el('div', { class: 'request-preview slide-sections' },
          window.SONG_RENDER.sectionsView(song.sections, { headingLevel: 3, labels }));
      }
      if (!item) return null;
      return el('div', { class: 'request-preview' },
        item.reference ? el('p', { class: 'ro-label', text: item.reference }) : null,
        item.body ? el('p', { class: 'lyrics slide-body', text: item.body }) : null);
    }

    function renderDialog() {
      const open = state.open;
      if (!open) return;
      if (open.list) {
        const list = pending();
        dialog.replaceChildren(el('div', { class: 'request-dialog-body' },
          el('h2', { id: 'request-heading', text: t('live.requests.listHeading') }),
          list.length
            ? el('ul', { class: 'request-list' }, list.map((r) => el('li', null,
              el('span', { class: 'request-list-text' },
                el('strong', { text: r.title }),
                el('span', { class: 'muted', text: [kindText(r), keyText(r.key), r.requestedBy ? t('live.requests.by', { name: r.requestedBy }) : ''].filter(Boolean).join(' · ') })),
              el('button', { type: 'button', text: t('live.requests.view'), onclick: () => openRequest(r.itemId) }))))
            : el('p', { class: 'muted', text: t('live.requests.none') }),
          el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'secondary', text: t('live.requests.close'), onclick: close }))));
        return;
      }
      const request = ((state.snap && state.snap.requests) || []).find((r) => r.itemId === open.itemId);
      const item = itemOf(open.itemId);
      if (!request || request.status !== 'pending') {
        close(); // answered meanwhile (another leader)
        return;
      }
      const radio = (value) => el('label', { class: 'checkbox' },
        el('input', {
          type: 'radio', name: 'request-position', value,
          checked: open.position === value,
          onchange: () => { open.position = value; },
        }),
        el('span', { text: t(`live.requests.${value}`) }));
      dialog.replaceChildren(el('div', { class: 'request-dialog-body' },
        el('p', { class: 'ro-label', text: [kindText(request), request.requestedBy ? t('live.requests.by', { name: request.requestedBy }) : ''].filter(Boolean).join(' · ') }),
        el('h2', { id: 'request-heading', text: request.title }),
        request.key ? el('p', null, el('span', { class: 'key-badge', text: keyText(request.key) })) : null,
        open.loading ? el('p', { class: 'muted', text: t('events.loading') }) : preview(item, open.song),
        el('fieldset', { class: 'request-position' },
          el('legend', { text: t('live.requests.positionLegend') }),
          radio('afterCurrent'), radio('end')),
        state.message ? el('p', { class: 'message error', role: 'alert', text: state.message }) : null,
        el('div', { class: 'form-actions' },
          el('button', { type: 'button', text: t('live.requests.accept'), onclick: () => answer(open.itemId, true) }),
          el('button', { type: 'button', class: 'danger', text: t('live.requests.refuse'), onclick: () => answer(open.itemId, false) }),
          el('button', { type: 'button', class: 'secondary', text: t('live.requests.close'), onclick: close }))));
    }

    badge.addEventListener('click', openList);
    dialog.setAttribute('aria-labelledby', 'request-heading');
    dialog.addEventListener('close', () => { state.open = null; state.message = ''; });

    return {
      update(snap) {
        state.snap = snap;
        const ids = pending().map((r) => r.itemId);
        // A proposal that was not there before gets the toast (not the ones already
        // waiting when the page opened: the badge shows those).
        if (state.seen) {
          const fresh = ids.filter((id) => !state.seen.has(id));
          if (fresh.length) state.toastFor = fresh[fresh.length - 1];
        }
        state.seen = new Set([...(state.seen || []), ...ids]);
        renderBadge();
        renderToast();
        if (state.open) renderDialog();
      },
      render() {
        renderBadge();
        renderToast();
        if (state.open) renderDialog();
      },
      get dialogOpen() { return dialog.open; },
    };
  }

  window.LIVE_REQUESTS = { create };
})();
