'use strict';

// The team of an event (lib/assignments.js), two faces of one component:
//   view  the "Echipa" card everyone sees on the event page (and the home card's row): the
//         invitation ("Participi?" Vin / Poate / Nu pot + note, and who answered what), who
//         serves where and their status; the person's own rows carry "Vin" / "Nu pot" (+ note).
//         The answers are selection controls: the chosen one is filled (accent) and checked.
//   edit  the editor's "Echipa" tab (owner, leader): per position, pick people (the ones with
//         that position first; someone unavailable that day greyed with the reason), remove,
//         status pills, "Trimite programarea"; above, "Trimite invitația" to the whole team
//         (then "Reamintește celor fără răspuns") and the answers; the picker lists first the
//         ones who come.
//
//   const card = TEAM_CARD.create(container, { eventId, mode, onSummary })
//   card.load()            // GET /api/events/:id/assignments, then render
//   TEAM_CARD.summaryText(summary)   // "5 confirmați · 1 așteaptă · 1 nu poate"
//   TEAM_CARD.answers(values, current, onPick, labelOf)   // the Vin / Poate / Nu pot choice group

(function () {
  const { api, el } = window.PAGE;
  const { t } = window.I18N;

  const summaryText = (s) => (s && s.total ? t('assign.summary', { accepted: s.accepted, pending: s.pending, declined: s.declined }) : t('assign.empty'));

  function statusPill(row) {
    return el('span', { class: `pill assign-pill assign-${row.status}`, text: t(`assign.status.${row.status}`) });
  }

  // A choice group of answers: the chosen one filled and checked; a tap on it again sends it
  // again (with the note as it is now).
  function answers(values, current, onPick, labelOf, ariaLabel) {
    return el('div', { class: 'choice-group answer-choice', role: 'group', 'aria-label': ariaLabel || null },
      ...values.map((value) => el('button', { type: 'button', 'data-answer': value, 'aria-pressed': String(value === current), text: labelOf(value), onclick: () => onPick(value) })));
  }

  // The answer of the signed-in person on one of their rows: Vin / Nu pot + a note.
  function answerBox(row, respond) {
    const note = el('input', { type: 'text', class: 'assign-note', maxlength: '200', placeholder: t('assign.noteLabel'), 'aria-label': t('assign.noteLabel'), value: row.note || '' });
    const labels = { accepted: t('assign.yes'), declined: t('assign.no') };
    return el('div', { class: 'assign-answer' }, answers(['accepted', 'declined'], row.status, (status) => respond(row, status, note.value), (v) => labels[v], window.PAGE.positionLabel({ name: row.positionName, emoji: row.positionEmoji })), note);
  }

  // "Participi?": Vin / Poate / Nu pot + a note (the person's answer to the invitation).
  function attendBox(me, onAnswer) {
    const note = el('input', { type: 'text', class: 'assign-note', id: 'attend-note', maxlength: '200', placeholder: t('attend.noteLabel'), 'aria-label': t('attend.noteLabel'), value: (me && me.note) || '' });
    return el('div', { class: 'attend-me' },
      el('p', { class: 'attend-question', id: 'attend-question', text: t('attend.question') }),
      el('div', { class: 'assign-answer' }, answers(['accepted', 'maybe', 'declined'], me && me.status, (status) => onAnswer(status, note.value), (v) => t(`attend.answers.${v}`), t('attend.question')), note));
  }

  // Who answered what: "Vine: Ana, Bob" per answer.
  function attendList(rows) {
    return el('ul', { class: 'attend-list' }, ...['accepted', 'maybe', 'declined', 'pending'].map((status) => {
      const people = rows.filter((r) => r.status === status);
      return people.length ? el('li', { class: `attend-group attend-${status}` },
        el('span', { class: `pill assign-pill assign-${status === 'maybe' ? 'pending' : status}`, text: `${t(`attend.status.${status}`)} · ${people.length}` }),
        el('span', { class: 'attend-names', text: people.map((r) => (r.note ? `${r.userName} (${r.note})` : r.userName)).join(', ') })) : null;
    }));
  }

  const attendSummary = (s) => t('attend.summary', s);

  function create(container, { eventId, mode = 'view', onSummary = () => {} } = {}) {
    const state = { data: null, message: '', kind: '', removing: null }; // removing: the row whose ✕ asks for a confirmation

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

    async function answerInvite(status, note) {
      const res = await api(`/api/events/${eventId}/attendance/respond`, { method: 'POST', body: { status, note } });
      if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
      state.data = res.body;
      say(t('attend.answered'), 'success');
      render();
      onSummary(res.body.summary, res.body);
    }

    async function invite(event, reminder) {
      const button = event && event.currentTarget;
      if (button) button.disabled = true;
      const res = await api(`/api/events/${eventId}/attendance/send`, { method: 'POST', body: reminder ? { reminder: true } : {} });
      if (!res.ok) {
        if (button) button.disabled = false;
        return say(res.body.error || t('common.networkError'), 'error');
      }
      state.data = res.body;
      const s = res.body.invited || {};
      const parts = [t('attend.sentTo', { n: s.sent || 0 })];
      if (s.withoutPush) parts.push(t('assign.sentNoPush', { n: s.withoutPush }));
      if (s.emailed) parts.push(t('assign.sentEmailed', { n: s.emailed }));
      say(parts.join(' · '), 'success');
      render();
    }

    // The "Participare" section: the view (everyone) or the editor's (with the send button).
    function attendSection(editing) {
      const a = state.data.attendance;
      if (!a) return null;
      const invited = a.invitedCount > 0;
      let action = null;
      if (editing) {
        const notInvited = (state.data.people || []).filter((p) => !a.rows.some((r) => r.userId === p.id && r.invitedAt)).length;
        const waiting = a.rows.filter((r) => r.status === 'pending').length;
        action = notInvited
          ? el('button', { type: 'button', id: 'send-invite', 'data-icon': 'mail', text: t('attend.send'), onclick: (event) => invite(event, false) })
          : el('button', { type: 'button', class: 'secondary', id: 'send-invite', 'data-icon': 'mail', text: t('attend.remind', { n: waiting }), disabled: waiting ? null : 'disabled', title: waiting ? '' : t('attend.allAnswered'), onclick: (event) => invite(event, true) });
      }
      return el('section', { class: 'attend', 'aria-labelledby': 'attend-heading' },
        el('div', { class: 'team-card-head' },
          el(editing ? 'h3' : 'h2', { id: 'attend-heading', text: t('attend.heading') }),
          el('p', { class: 'team-card-summary', id: 'attend-summary', text: invited || a.rows.length ? attendSummary(a.summary) : t('attend.notInvited') }),
          action),
        editing ? el('p', { class: 'hint', text: t('attend.sendHint') }) : null,
        a.me || invited ? attendBox(a.me, answerInvite) : null,
        a.rows.length ? attendList(a.rows) : null);
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
        attendSection(false),
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
      // the invitation's answers first: the ones who come, then maybe; "Nu pot" greyed
      const answer = new Map(((d.attendance && d.attendance.rows) || []).map((r) => [r.userId, r.status]));
      const usual = (a, b) => Number(b.positionIds.includes(position.id)) - Number(a.positionIds.includes(position.id));
      const coming = free.filter((p) => answer.get(p.id) === 'accepted').sort(usual);
      const maybe = free.filter((p) => answer.get(p.id) === 'maybe').sort(usual);
      const declined = free.filter((p) => answer.get(p.id) === 'declined');
      const rest = free.filter((p) => !['accepted', 'maybe', 'declined'].includes(answer.get(p.id)));
      const suggested = rest.filter((p) => p.positionIds.includes(position.id));
      const others = rest.filter((p) => !p.positionIds.includes(position.id));
      const answered = answer.size > 0;
      const select = el('select', { class: 'assign-picker', 'aria-label': t('assign.addFor', { position: position.name }) },
        el('option', { value: '', text: t('assign.addPerson') }),
        coming.length ? el('optgroup', { label: t('attend.pickComing') }, ...coming.map(option)) : null,
        maybe.length ? el('optgroup', { label: t('attend.pickMaybe') }, ...maybe.map(option)) : null,
        suggested.length ? el('optgroup', { label: answered ? `${t('attend.pickNoAnswer')} · ${t('assign.suggested')}` : t('assign.suggested') }, ...suggested.map(option)) : null,
        others.length ? el('optgroup', { label: answered ? `${t('attend.pickNoAnswer')} · ${t('assign.others')}` : t('assign.others') }, ...others.map(option)) : null,
        declined.length ? el('optgroup', { label: t('attend.status.declined') }, ...declined.map((p) => el('option', { value: String(p.id), disabled: 'disabled', text: t('attend.pickDeclined', { name: p.name }) }))) : null);
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
        attendSection(true),
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
              el('button', { type: 'button', class: 'secondary icon-button assign-remove', 'aria-label': t('assign.remove', { name: row.userName }), onclick: () => { state.removing = row.id; render(); } }, el('span', { 'aria-hidden': 'true', text: '✕' })),
              // ✕ asks first: "Scoți pe <name> de la <position>?" (told people get a notice)
              state.removing === row.id ? el('div', { class: 'assign-remove-confirm', role: 'group' },
                el('p', { text: t('assign.removeConfirm', { name: row.userName, position: position.name }) }),
                row.notifiedAt && row.status !== 'declined' ? el('p', { class: 'hint', text: t('assign.removeTold', { name: row.userName }) }) : null,
                el('div', { class: 'form-actions' },
                  el('button', { type: 'button', class: 'danger', 'data-icon': 'close', 'data-remove-yes': String(row.id), text: t('assign.removeYes'), onclick: () => { state.removing = null; save(current().filter((c) => !(c.userId === row.userId && c.positionId === row.positionId))); } }),
                  el('button', { type: 'button', class: 'secondary', text: t('assign.removeNo'), onclick: () => { state.removing = null; render(); } }))) : null);
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

  window.TEAM_CARD = { create, summaryText, answers };
})();
