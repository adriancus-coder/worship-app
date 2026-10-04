'use strict';

// The invitations pop-up (loaded by public/shell.js on every menu page, never on the live,
// follow or projector pages): what waits for this person's answer (GET /api/my-invitations)
// opens as a dialog, one at a time - "Invitație: Duminică, 11 octombrie · 15:00 — Participi?"
// with Vin / Poate / Nu pot (+ a note), or "Ești programat la 🎤 Voce" with Vin / Nu pot.
// The answer saves at once and the next one shows; "Mai târziu" hides that one until the next
// session. Checked on load and whenever the app comes back to the front.

(function () {
  const { api, el, formatDate, positionLabel } = window.PAGE;
  const { t } = window.I18N;
  const LATER_KEY = 'wa_answer_later';
  let dialog = null;
  let busy = false;

  const keyOf = (item) => `${item.kind}:${item.kind === 'assignment' ? item.id : item.eventId}`;
  const later = () => { try { return JSON.parse(sessionStorage.getItem(LATER_KEY) || '[]'); } catch { return []; } };
  const putOff = (item) => { try { sessionStorage.setItem(LATER_KEY, JSON.stringify([...later(), keyOf(item)])); } catch { /* this page only */ } };

  function build() {
    dialog = el('dialog', { class: 'answer-popup', id: 'answer-popup', 'aria-labelledby': 'answer-popup-title' });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); }); // Escape = "Mai târziu" (below)
    document.body.append(dialog);
  }

  function show(item, left) {
    if (!dialog) build();
    const when = [formatDate(item.eventDate), item.startTime].filter(Boolean).join(' · ');
    const values = item.kind === 'assignment' ? ['accepted', 'declined'] : ['accepted', 'maybe', 'declined'];
    const label = (v) => (item.kind === 'assignment' ? t(v === 'accepted' ? 'assign.yes' : 'assign.no') : t(`attend.answers.${v}`));
    const note = el('input', { type: 'text', class: 'assign-note', id: 'answer-popup-note', maxlength: '200', placeholder: t('attend.noteLabel'), 'aria-label': t('attend.noteLabel') });
    const message = el('p', { class: 'message error', role: 'alert' });
    const answer = async (status) => {
      if (busy) return;
      busy = true;
      const url = item.kind === 'assignment' ? `/api/events/${item.eventId}/assignments/${item.id}/respond` : `/api/events/${item.eventId}/attendance/respond`;
      const res = await api(url, { method: 'POST', body: { status, note: note.value.trim() } }).catch(() => ({ ok: false, body: {} }));
      busy = false;
      if (!res.ok) { message.textContent = res.body.error || t('common.networkError'); return; }
      dialog.close();
      document.dispatchEvent(new CustomEvent('answers:changed'));
      check();
    };
    const close = () => { putOff(item); dialog.close(); check(); };
    dialog.onkeydown = (event) => { if (event.key === 'Escape') close(); };
    dialog.replaceChildren(
      el('p', { class: 'answer-popup-kicker', text: item.kind === 'assignment' ? t('answerPopup.scheduled') : t('answerPopup.invited') }),
      el('h2', { id: 'answer-popup-title', text: item.eventName }),
      el('p', { class: 'answer-popup-when', text: when }),
      item.kind === 'assignment' ? el('p', { class: 'answer-popup-position', text: t('assign.youAre', { position: positionLabel({ name: item.positionName, emoji: item.positionEmoji }) }) }) : null,
      el('p', { class: 'answer-popup-question', text: t('attend.question') }),
      el('div', { class: 'choice-group answer-choice answer-popup-choice', role: 'group', 'aria-label': t('attend.question') },
        ...values.map((v) => el('button', { type: 'button', 'data-answer': v, 'aria-pressed': 'false', text: label(v), onclick: () => answer(v) }))),
      note,
      message,
      el('div', { class: 'form-actions' },
        el('a', { class: 'button secondary', href: `/events/${item.eventId}`, 'data-icon': 'details', text: t('answerPopup.open') }),
        el('button', { type: 'button', class: 'secondary', id: 'answer-popup-later', text: left > 1 ? t('answerPopup.laterMore', { n: left - 1 }) : t('answerPopup.later'), onclick: close })));
    if (!dialog.open) dialog.showModal();
  }

  async function check() {
    if (dialog && dialog.open) return;
    if (document.querySelector('dialog[open]')) return; // never over another dialog
    const res = await api('/api/my-invitations').catch(() => null);
    if (!res || !res.ok) return;
    const skip = new Set(later());
    const items = res.body.items.filter((item) => !skip.has(keyOf(item)));
    if (items.length) show(items[0], items.length);
  }

  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.ANSWER_POPUP = { check };
})();
