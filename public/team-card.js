'use strict';

// The team of an event (lib/assignments.js), two faces of one component:
//   view  the "Echipa" card everyone sees on the event page (and the home card's row): who
//         serves where and their status; the person's own rows carry "Vin" / "Nu pot" (+ note).
//   edit  the editor's "Echipa" tab (owner, leader): per position, pick people (the ones with
//         that position first; someone unavailable that day greyed with the reason), remove,
//         status pills, "Trimite programarea".
//
//   const card = TEAM_CARD.create(container, { eventId, mode, onSummary })
//   card.load()            // GET /api/events/:id/assignments, then render
//   TEAM_CARD.summaryText(summary)   // "5 confirmați · 1 așteaptă · 1 nu poate"

(function () {
  const { api, el } = window.PAGE;
  const { t } = window.I18N;

  const summaryText = (s) => (s && s.total ? t('assign.summary', { accepted: s.accepted, pending: s.pending, declined: s.declined }) : t('assign.empty'));

  function statusPill(row) {
    return el('span', { class: `pill assign-pill assign-${row.status}`, text: t(`assign.status.${row.status}`) });
  }

  // The answer of the signed-in person on one of their rows: Vin / Nu pot + a note.
  function answerBox(row, respond) {
    const note = el('input', { type: 'text', class: 'assign-note', maxlength: '200', placeholder: t('assign.noteLabel'), 'aria-label': t('assign.noteLabel'), value: row.note || '' });
    const yes = el('button', { type: 'button', class: row.status === 'accepted' ? 'secondary' : '', 'data-answer': 'accepted', 'data-icon': 'check', text: t('assign.yes'), onclick: () => respond(row, 'accepted', note.value) });
    const no = el('button', { type: 'button', class: 'secondary', 'data-answer': 'declined', 'data-icon': 'close', text: t('assign.no'), onclick: () => respond(row, 'declined', note.value) });
    if (row.status === 'accepted') yes.disabled = true;
    if (row.status === 'declined') no.disabled = true;
    return el('div', { class: 'assign-answer' }, el('div', { class: 'assign-answer-buttons' }, yes, no), note);
  }

  function create(container, { eventId, mode = 'view', onSummary = () => {} } = {}) {
    const state = { data: null, message: '', kind: '' };

    async function load() {
      const res = await api(`/api/events/${eventId}/assignments`);
      if (!res.ok) {
        container.replaceChildren(el('p', { class: 'message error', text: res.body.error || t('common.networkError') }));
        return null;
      }
      state.data = res.body;
      render();
      onSummary(res.body.summary, res.body);
      return res.body;
    }

    async function respond(row, status, note) {
      const res = await api(`/api/events/${eventId}/assignments/${row.id}/respond`, { method: 'POST', body: { status, note } });
      if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
      state.data = res.body;
      say(t('assign.answered'), 'success');
      render();
      onSummary(res.body.summary, res.body);
    }

    function say(text, kind) {
      state.message = text;
      state.kind = kind;
      const box = container.querySelector('.assign-message');
      if (box) {
        box.className = `message assign-message${kind ? ` ${kind}` : ''}`;
        box.textContent = text;
      }
    }

    // --- view: grouped by position --------------------------------------------------------
    function renderView() {
      const d = state.data;
      const groups = new Map();
      for (const row of d.assignments) {
        if (!groups.has(row.positionId)) groups.set(row.positionId, { name: window.PAGE.positionLabel({ name: row.positionName, emoji: row.positionEmoji }), rows: [] });
        groups.get(row.positionId).rows.push(row);
      }
      const meIds = new Set(d.me.map((r) => r.id));
      container.replaceChildren(el('section', { class: 'team-card', 'aria-labelledby': 'team-card-heading' },
        el('div', { class: 'team-card-head' },
          el('h2', { id: 'team-card-heading', text: t('assign.heading') }),
          el('p', { class: 'team-card-summary', text: summaryText(d.summary) })),
        ...[...groups.values()].map((g) => el('div', { class: 'team-group' },
          el('h3', { text: g.name }),
          el('ul', { class: 'team-group-list' }, ...g.rows.map((row) => el('li', { class: `assign-row assign-row-${row.status}${meIds.has(row.id) ? ' mine' : ''}` },
            el('span', { class: 'assign-name', text: row.userName }),
            statusPill(row),
            row.note && !meIds.has(row.id) ? el('span', { class: 'assign-note-text', text: row.note }) : null,
            meIds.has(row.id) ? answerBox(row, respond) : null))))),
        el('p', { class: `message assign-message${state.kind ? ` ${state.kind}` : ''}`, role: 'status', 'aria-live': 'polite', text: state.message })));
    }

    // --- edit: per position, a picker ----------------------------------------------------
    async function save(wanted) {
      const res = await api(`/api/events/${eventId}/assignments`, { method: 'PUT', body: { assignments: wanted } });
      if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
      state.data = res.body;
      say('', '');
      render();
      onSummary(res.body.summary, res.body);
    }

    const current = () => state.data.assignments.map((r) => ({ userId: r.userId, positionId: r.positionId }));

    function picker(position) {
      const d = state.data;
      const taken = new Set(d.assignments.filter((r) => r.positionId === position.id).map((r) => r.userId));
      const free = d.people.filter((p) => !taken.has(p.id));
      const option = (p) => {
        const busy = p.unavailable; // { note } when the person cannot on the event date (commit 3)
        return el('option', { value: String(p.id), disabled: busy ? 'disabled' : null, text: busy ? t('assign.unavailableOption', { name: p.name, reason: busy.note || t('assign.unavailable') }) : p.name });
      };
      const suggested = free.filter((p) => p.positionIds.includes(position.id));
      const others = free.filter((p) => !p.positionIds.includes(position.id));
      const select = el('select', { class: 'assign-picker', 'aria-label': t('assign.addFor', { position: position.name }) },
        el('option', { value: '', text: t('assign.addPerson') }),
        suggested.length ? el('optgroup', { label: t('assign.suggested') }, ...suggested.map(option)) : null,
        others.length ? el('optgroup', { label: t('assign.others') }, ...others.map(option)) : null);
      select.addEventListener('change', () => {
        const userId = Number(select.value);
        if (userId) save([...current(), { userId, positionId: position.id }]);
      });
      return select;
    }

    function renderEdit() {
      const d = state.data;
      const active = d.positions.filter((p) => p.active || d.assignments.some((r) => r.positionId === p.id));
      const pending = d.assignments.filter((r) => r.status === 'pending' && !r.notifiedAt).length;
      const unavailableHere = (row) => { const p = d.people.find((x) => x.id === row.userId); return p && p.unavailable ? p.unavailable : null; };
      container.replaceChildren(el('div', { class: 'team-edit' },
        el('div', { class: 'team-card-head' },
          el('p', { class: 'team-card-summary', id: 'team-edit-summary', text: summaryText(d.summary) }),
          el('button', { type: 'button', id: 'send-schedule', 'data-icon': 'mail', text: t('assign.send'), disabled: pending ? null : 'disabled', title: pending ? '' : t('assign.nothingToSend'), onclick: (event) => send(event) })),
        el('p', { class: 'hint', text: t('assign.editHint') }),
        active.length ? null : el('p', { class: 'muted', text: t('assign.noPositions') }),
        ...active.map((position) => el('div', { class: 'team-position', 'data-position': String(position.id) },
          el('h3', { text: window.PAGE.positionLabel(position) }),
          el('ul', { class: 'team-group-list' }, ...d.assignments.filter((r) => r.positionId === position.id).map((row) => {
            const busy = unavailableHere(row);
            return el('li', { class: `assign-row assign-row-${row.status}${busy ? ' unavailable' : ''}` },
              el('span', { class: 'assign-name', text: row.userName }),
              statusPill(row),
              row.note ? el('span', { class: 'assign-note-text', text: row.note }) : null,
              busy ? el('span', { class: 'assign-warning', text: t('assign.unavailableWarning', { reason: busy.note || t('assign.unavailable') }) }) : null,
              row.status === 'declined' ? el('span', { class: 'assign-warning', text: t('assign.declinedHint') }) : null,
              // "Trimite" / "Retrimite" for this person only, while the answer is pending
              row.status === 'pending' ? el('button', { type: 'button', class: 'secondary assign-send-one', 'data-icon': 'mail', 'data-assignment': String(row.id), text: t(row.notifiedAt ? 'assign.resendOne' : 'assign.sendOne'), 'aria-label': t(row.notifiedAt ? 'assign.resendOneFor' : 'assign.sendOneFor', { name: row.userName }), onclick: (event) => send(event, [row.id]) }) : null,
              el('button', { type: 'button', class: 'secondary icon-button assign-remove', 'aria-label': t('assign.remove', { name: row.userName }), onclick: () => save(current().filter((c) => !(c.userId === row.userId && c.positionId === row.positionId))) }, el('span', { 'aria-hidden': 'true', text: '✕' })));
          })),
          position.active ? picker(position) : null)),
        el('p', { class: `message assign-message${state.kind ? ` ${state.kind}` : ''}`, role: 'status', 'aria-live': 'polite', text: state.message })));
    }

    // ids: one person's rows ("Trimite" / "Retrimite" under the name), else everyone not yet sent.
    async function send(event, ids) {
      const button = event && event.currentTarget;
      if (button) button.disabled = true;
      const res = await api(`/api/events/${eventId}/assignments/send`, { method: 'POST', body: ids ? { ids } : {} });
      if (!res.ok) {
        if (button) button.disabled = false;
        return say(res.body.error || t('common.networkError'), 'error');
      }
      state.data = res.body;
      const s = res.body.sent || {};
      const parts = [t('assign.sentTo', { n: s.sent || 0 })];
      if (s.withoutPush) parts.push(t('assign.sentNoPush', { n: s.withoutPush }));
      if (s.emailed) parts.push(t('assign.sentEmailed', { n: s.emailed }));
      say(parts.join(' · '), 'success');
      render();
    }

    function render() {
      if (!state.data) return;
      if (mode === 'edit' && state.data.canAssign) renderEdit();
      else renderView();
    }

    document.addEventListener('i18n:change', render);
    return { load, render, get data() { return state.data; } };
  }

  window.TEAM_CARD = { create, summaryText };
})();
