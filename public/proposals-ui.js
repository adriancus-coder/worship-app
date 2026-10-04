'use strict';

// Song proposals (routes/proposals.js), two faces of one module:
//   PROPOSALS_UI.member(container, { eventId })
//     "Propune o cântare" (the shared song search in pick mode, library only) -> an optional
//     note -> "Trimite"; under it "Propunerile mele" with status pills and the leader's note.
//     Hidden once the event is finished.
//   PROPOSALS_UI.roles(container, { eventId, live, onCount, position })
//     "Propuneri (n)": every proposal with the proposer's name and note; open ones carry
//     "Adaugă în setlist" (position 'end' in the editor, 'afterCurrent' while live), "Doar pe
//     proiector" (live only) and "Respinge" (+ optional note); added ones say where the song
//     landed. onCount(openCount) feeds the badges.
// Both reload on the document event 'proposals:changed'.

(function () {
  const { api, el } = window.PAGE;
  const { t } = window.I18N;
  const REFRESH_MS = 30000;

  const statusPill = (p) => el('span', { class: `pill proposal-pill proposal-${p.status}`, text: t(`proposals.status.${p.status}`) });
  const keyText = (p) => (p.songKey && window.NOTATION ? ` · ${t('options.songKeyShort', { key: window.NOTATION.chord(p.songKey) })}` : '');

  function member(container, { eventId }) {
    const state = { data: null, picked: null, message: '', kind: '' };
    let dialog = null;
    let search = null;

    function say(text, kind) {
      state.message = text || '';
      state.kind = kind || '';
      render();
    }

    async function load() {
      const res = await api(`/api/events/${eventId}/proposals`);
      if (!res.ok) return;
      state.data = res.body;
      render();
    }

    // The dialog: the song search (library only for members), then the note step.
    function build() {
      const root = el('div', { class: 'song-pick' });
      const noteBox = el('div', { class: 'proposal-note-step', hidden: true });
      const noteInput = el('input', { type: 'text', id: 'proposal-note', maxlength: '200', placeholder: t('proposals.notePlaceholder'), 'aria-label': t('proposals.noteLabel') });
      const pickedText = el('p', { class: 'proposal-picked' });
      const sendButton = el('button', { type: 'button', id: 'proposal-send', 'data-icon': 'check', text: t('proposals.send'), onclick: submit });
      const back = el('button', { type: 'button', class: 'secondary', text: t('proposals.pickAnother'), onclick: () => { state.picked = null; noteBox.hidden = true; root.hidden = false; search.focus(); } });
      noteBox.append(pickedText, el('label', { class: 'proposal-note-label' }, el('span', { text: t('proposals.noteLabel') }), noteInput), el('div', { class: 'form-actions' }, sendButton, back));
      const message = el('p', { class: 'message error', role: 'alert', id: 'proposal-dialog-message' });
      dialog = el('dialog', { class: 'wide-dialog song-pick-dialog proposal-dialog', 'aria-labelledby': 'proposal-heading' },
        el('div', { class: 'song-pick-head' },
          el('h2', { id: 'proposal-heading', text: t('proposals.heading') }),
          el('button', { type: 'button', class: 'shell-close preview-close-x', 'aria-label': t('shell.close'), text: '✕', onclick: () => dialog.close() })),
        el('p', { class: 'hint', text: t('proposals.hint') }),
        root, noteBox, message,
        el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'secondary', text: t('proposals.close'), onclick: () => dialog.close() })));
      document.body.append(dialog);
      search = window.SONG_SEARCH.create(root, {
        mode: 'pick', prefix: 'prop-', headingLevel: 3, limit: 30,
        localActions: (song) => [{ label: t('proposals.pick'), icon: 'plus', primary: true, ariaLabel: t('proposals.pickLabel', { title: song.title }), run: (s) => { state.picked = s; pickedText.textContent = t('proposals.picked', { title: s.title }); root.hidden = true; noteBox.hidden = false; noteInput.value = ''; noteInput.focus(); } }],
      });
      search.setOnline(false); // members: the library only, never online results
      dialog.noteInput = noteInput;
      dialog.message = message;
      dialog.root = root;
      dialog.noteBox = noteBox;
    }

    async function submit() {
      if (!state.picked) return;
      const res = await api(`/api/events/${eventId}/proposals`, { method: 'POST', body: { songId: state.picked.id, note: dialog.noteInput.value } });
      if (!res.ok) { dialog.message.textContent = res.body.error || t('common.networkError'); return; }
      dialog.close();
      state.data = res.body;
      say(t('proposals.sent', { title: state.picked.title }), 'success');
      state.picked = null;
      document.dispatchEvent(new CustomEvent('proposals:changed', { detail: { from: 'member' } }));
    }

    function open() {
      if (!dialog) build();
      state.picked = null;
      dialog.root.hidden = false;
      dialog.noteBox.hidden = true;
      dialog.message.textContent = '';
      search.reset();
      dialog.showModal();
      search.focus();
    }

    function render() {
      const d = state.data;
      if (!d) return;
      const closed = d.eventStatus === 'finished';
      container.replaceChildren(el('section', { class: 'proposals proposals-member', 'aria-labelledby': 'proposals-mine-heading' },
        closed ? null : el('button', { type: 'button', class: 'secondary', id: 'propose-song', 'data-icon': 'plus', text: t('proposals.propose'), onclick: open }),
        el('p', { class: `message proposal-message${state.kind ? ` ${state.kind}` : ''}`, role: 'status', 'aria-live': 'polite', text: state.message }),
        d.proposals.length ? el('h3', { id: 'proposals-mine-heading', class: 'proposals-heading', text: t('proposals.mine') }) : el('span', { id: 'proposals-mine-heading', class: 'sr-only', text: t('proposals.mine') }),
        d.proposals.length ? el('ul', { class: 'proposal-list' }, ...d.proposals.map((p) => el('li', { class: `proposal-row proposal-row-${p.status}` },
          el('span', { class: 'proposal-title', text: `${p.songTitle}${keyText(p)}` }),
          statusPill(p),
          p.note ? el('span', { class: 'proposal-note', text: p.note }) : null,
          p.decisionNote ? el('span', { class: 'proposal-decision', text: t('proposals.leaderNote', { note: p.decisionNote }) }) : null))) : null));
    }

    document.addEventListener('proposals:changed', () => load().catch(() => {}));
    document.addEventListener('i18n:change', render);
    const timer = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, REFRESH_MS);
    load().catch(() => {});
    return { load, open, stop: () => clearInterval(timer) };
  }

  function roles(container, { eventId, live = () => false, onCount = () => {}, position = 'end' }) {
    const state = { data: null, declining: null, message: '', kind: '' };

    async function load() {
      const res = await api(`/api/events/${eventId}/proposals`);
      if (!res.ok) return;
      state.data = res.body;
      render();
      onCount(res.body.openCount, res.body);
    }

    async function decide(p, action, note) {
      const url = `/api/events/${eventId}/proposals/${p.id}/${action === 'decline' ? 'decline' : 'add'}`;
      const body = action === 'decline' ? { note } : { target: action, position: live() ? position : 'end' };
      const res = await api(url, { method: 'POST', body });
      if (!res.ok) { state.message = res.body.error || t('common.networkError'); state.kind = 'error'; render(); return; }
      state.data = res.body;
      state.declining = null;
      state.message = t(action === 'decline' ? 'proposals.declined' : (action === 'projector' ? 'proposals.addedProjector' : 'proposals.addedSetlist'), { title: p.songTitle });
      state.kind = 'success';
      render();
      onCount(res.body.openCount, res.body);
      document.dispatchEvent(new CustomEvent('proposals:changed', { detail: { from: 'roles' } }));
    }

    function row(p) {
      const open = p.status === 'open';
      const declining = state.declining === p.id;
      const noteInput = declining ? el('input', { type: 'text', class: 'proposal-decline-note', maxlength: '200', placeholder: t('proposals.declineNotePlaceholder'), 'aria-label': t('proposals.declineNoteLabel') }) : null;
      return el('li', { class: `proposal-row proposal-row-${p.status}`, 'data-proposal': String(p.id) },
        el('span', { class: 'proposal-title', text: `${p.songTitle}${keyText(p)}` }),
        statusPill(p),
        el('span', { class: 'proposal-by', text: t('proposals.by', { name: p.proposerName || '' }) }),
        p.note ? el('span', { class: 'proposal-note', text: p.note }) : null,
        p.status === 'added' ? el('span', { class: 'proposal-decision', text: t(p.addedTarget === 'projector' ? 'proposals.landedProjector' : 'proposals.landedSetlist') }) : null,
        p.status === 'declined' && p.decisionNote ? el('span', { class: 'proposal-decision', text: t('proposals.leaderNote', { note: p.decisionNote }) }) : null,
        open && !declining ? el('div', { class: 'proposal-actions' },
          el('button', { type: 'button', 'data-icon': 'plus', 'data-action': 'setlist', text: t(live() ? 'proposals.addSetlist' : 'proposals.addEnd'), onclick: () => decide(p, 'setlist') }),
          live() ? el('button', { type: 'button', class: 'secondary', 'data-icon': 'projector', 'data-action': 'projector', text: t('proposals.addProjector'), onclick: () => decide(p, 'projector') }) : null,
          el('button', { type: 'button', class: 'secondary danger-text', 'data-icon': 'close', 'data-action': 'decline', text: t('proposals.decline'), onclick: () => { state.declining = p.id; render(); container.querySelector('.proposal-decline-note').focus(); } })) : null,
        declining ? el('div', { class: 'proposal-actions proposal-decline' }, noteInput,
          el('button', { type: 'button', class: 'danger', 'data-action': 'decline-confirm', text: t('proposals.declineConfirm'), onclick: () => decide(p, 'decline', noteInput.value) }),
          el('button', { type: 'button', class: 'secondary', text: t('proposals.cancel'), onclick: () => { state.declining = null; render(); } })) : null);
    }

    function render() {
      const d = state.data;
      if (!d) return;
      container.replaceChildren(el('section', { class: 'proposals proposals-roles', 'aria-labelledby': 'proposals-heading-roles' },
        el('h3', { id: 'proposals-heading-roles', class: 'proposals-heading' }, el('span', { text: t('proposals.rolesHeading') }), ' ', el('span', { class: 'tab-count', id: 'proposals-count', text: d.openCount ? String(d.openCount) : '' })),
        d.proposals.length ? null : el('p', { class: 'muted', text: t('proposals.none') }),
        d.proposals.length ? el('ul', { class: 'proposal-list' }, ...d.proposals.map(row)) : null,
        el('p', { class: `message proposal-message${state.kind ? ` ${state.kind}` : ''}`, role: 'status', 'aria-live': 'polite', text: state.message })));
    }

    document.addEventListener('proposals:changed', () => load().catch(() => {}));
    document.addEventListener('i18n:change', render);
    const timer = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, REFRESH_MS);
    load().catch(() => {});
    return { load, stop: () => clearInterval(timer) };
  }

  window.PROPOSALS_UI = { member, roles };
})();
