'use strict';

// The live-mode controls the leader page and the operator console share:
//   "Împreună · Separat"                    live.mode together | split
//   "Echipa: Urmărește live · Derulează liber"  team.mode follow | free
// the handover flow around them (a LEADER's "Împreună" in split mode is a request the
// operator / owner answers: lib/live.js), and the short info toast for additions made by
// someone else ("<name> a adăugat …"): it hides after 5 s and never takes clicks.
//
//   const modes = LIVE_MODES.controls(container, { send, t, el });
//   modes.setMe(user);                       // who this page is (role, id)
//   modes.update(snap);                      // hidden until the event is live
//   modes.handover(event);                   // socket 'live:handover'
//   modes.statusText();                      // for the big lyrics' status line
//   const toast = LIVE_MODES.toast(box, { t });
//   socket.on('live:notice', toast.show);
//
// Leader page: "Cerere trimisă… 58 s" with "Anulează" while pending, "Operatorul a refuzat"
// for 5 s after a refusal, the switch flips itself on accept (the snapshot). Console (owner /
// operator): a toast "Liderul cere controlul proiectorului" with Acceptă (primary, Enter
// when focused) / Refuză that never covers the step grid, and a badge on the switch.

(function () {
  const TOAST_MS = 5000;
  const ANSWER_MS = 5000;
  const ANSWER_ROLES = ['owner', 'operator'];

  function controls(container, { send, t, el }) {
    let snap = null;
    let me = null;
    const hand = { answer: null, timer: null, askedBy: null }; // answer: { type, until }
    const segmented = (labelKey, command, values) => {
      const label = el('span', { class: 'mode-label' });
      const buttons = values.map((value) => el('button', {
        type: 'button',
        class: 'secondary',
        'data-value': value,
        'aria-pressed': 'false',
        onclick: () => {
          const current = command === 'live.mode' ? snap && snap.mode : snap && snap.teamMode;
          if (current !== value) send(command, { mode: value });
        },
      }));
      const group = el('div', { class: 'mode-switch', role: 'group' }, ...buttons);
      const badge = el('span', { class: 'handover-badge', hidden: true });
      const row = el('div', { class: 'mode-row' }, label, group, badge);
      return { row, label, group, buttons, badge, labelKey, command, values };
    };
    const liveMode = segmented('live.modes.label', 'live.mode', ['together', 'split']);
    const teamMode = segmented('live.modes.teamLabel', 'team.mode', ['follow', 'free']);
    const hint = el('p', { class: 'hint mode-hint' });
    // The leader's request line: "Cerere trimisă… 58 s" + Anulează, or the answer.
    const lineText = el('p');
    const cancel = el('button', { type: 'button', class: 'secondary', onclick: () => send('handover.cancel') });
    const line = el('div', { class: 'handover-line', role: 'status', 'aria-live': 'polite', hidden: true }, lineText, cancel);
    container.classList.add('mode-controls');
    container.replaceChildren(liveMode.row, teamMode.row, hint, line);
    // The approver's toast (owner / operator), on the page body so it floats over nothing important.
    const toastText = el('p');
    const accept = el('button', { type: 'button', 'data-icon': 'check', onclick: () => send('handover.accept') });
    const refuse = el('button', { type: 'button', class: 'secondary', 'data-icon': 'close', onclick: () => send('handover.refuse') });
    const toast = el('div', { class: 'handover-toast', role: 'alertdialog', 'aria-modal': 'false', 'aria-live': 'assertive', tabindex: '-1', hidden: true },
      toastText, el('div', { class: 'handover-toast-actions' }, accept, refuse));
    toast.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.target.closest('button')) {
        event.preventDefault();
        send('handover.accept');
      }
    });
    document.body.append(toast);

    const live = () => Boolean(snap) && snap.status === 'live';
    const pending = () => (live() && snap.handover && snap.handover.expiresAt > Date.now() ? snap.handover : null);
    const mine = () => Boolean(pending() && me && pending().requestedBy === me.id);
    const canAnswer = () => Boolean(me && ANSWER_ROLES.includes(me.role));
    const secondsLeft = () => Math.max(0, Math.ceil((pending().expiresAt - Date.now()) / 1000));

    function tick() {
      clearTimeout(hand.timer);
      hand.timer = null;
      const p = pending();
      if (hand.answer && hand.answer.until <= Date.now()) hand.answer = null;
      if (p && mine()) lineText.textContent = t('live.modes.handoverSent', { s: secondsLeft() });
      if (p || hand.answer) hand.timer = setTimeout(() => { tick(); if (!pending()) render(); }, 1000);
      if (!p && !hand.answer) render();
    }

    // The text the big lyrics' status line shows for the handover, or ''.
    function statusText() {
      if (!live()) return '';
      const p = pending();
      if (p && mine()) return t('live.modes.handoverSent', { s: secondsLeft() });
      if (p && canAnswer()) return t('live.modes.handoverAsk', { name: hand.askedBy || t('live.modes.leader') });
      if (hand.answer && hand.answer.until > Date.now()) return t(`live.modes.handover${hand.answer.type === 'refused' ? 'Refused' : 'Accepted'}`);
      return '';
    }

    function render() {
      container.hidden = !live();
      toast.hidden = true;
      if (!live()) {
        line.hidden = true;
        return;
      }
      for (const part of [liveMode, teamMode]) {
        const id = `${part.command.replace('.', '-')}-label`;
        part.label.id = id;
        part.label.textContent = t(part.labelKey);
        part.group.setAttribute('aria-labelledby', id);
        const current = part.command === 'live.mode' ? snap.mode : snap.teamMode;
        for (const button of part.buttons) {
          button.textContent = t(`live.modes.${button.dataset.value}`);
          button.setAttribute('aria-pressed', String(button.dataset.value === current));
        }
      }
      const leader = me && me.role === 'leader';
      hint.textContent = snap.mode === 'split'
        ? t(leader ? 'live.modes.splitLeaderHint' : 'live.modes.splitHint')
        : t('live.modes.togetherHint');
      const p = pending();
      // the requester's line
      const answer = hand.answer && hand.answer.until > Date.now() ? hand.answer : null;
      line.hidden = !(p && mine()) && !answer;
      line.classList.toggle('refused', Boolean(answer && answer.type === 'refused'));
      cancel.hidden = !(p && mine());
      cancel.textContent = t('live.modes.handoverCancel');
      if (p && mine()) lineText.textContent = t('live.modes.handoverSent', { s: secondsLeft() });
      else if (answer) lineText.textContent = t(`live.modes.handover${answer.type === 'refused' ? 'Refused' : 'Accepted'}`);
      // the approver's badge and toast
      const asked = Boolean(p && !mine() && canAnswer());
      liveMode.badge.hidden = !asked;
      liveMode.badge.textContent = t('live.modes.handoverBadge');
      liveMode.group.classList.toggle('pending', asked);
      toast.hidden = !asked;
      if (asked) {
        toastText.textContent = t('live.modes.handoverAsk', { name: hand.askedBy || t('live.modes.leader') });
        accept.textContent = t('live.modes.handoverAccept');
        refuse.textContent = t('live.modes.handoverRefuse');
      }
      if ((p && mine()) || asked || answer) tick();
    }

    return {
      setMe(user) {
        me = user ? { id: user.id, role: user.role } : null;
        if (snap) render();
      },
      update(next) {
        snap = next;
        render();
      },
      // socket 'live:handover': { type: requested | accepted | refused | cancelled, by, byUserId }
      handover(event) {
        if (!event || !snap) return;
        if (event.type === 'requested') {
          hand.askedBy = event.by || null;
          hand.answer = null;
          // The toast takes focus so Enter accepts, unless someone is typing.
          if (canAnswer() && !(document.activeElement && document.activeElement.closest('input, textarea, select, dialog[open]'))) {
            setTimeout(() => { if (!toast.hidden) accept.focus(); }, 0);
          }
        } else if (event.type === 'refused' || event.type === 'accepted') {
          // The answer, shown to the one who asked (accept: the switch flips with the snapshot).
          const wasMine = Boolean(me && (event.requestedBy === me.id || mine()));
          hand.answer = wasMine && event.type === 'refused' ? { type: 'refused', until: Date.now() + ANSWER_MS } : null;
        } else if (event.type === 'cancelled') hand.answer = null;
        render();
      },
      statusText,
      render,
    };
  }

  function toast(box, { t }) {
    let timer = null;
    box.classList.add('info-toast');
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.hidden = true;
    return {
      show(notice) {
        if (!notice || notice.type !== 'itemAdded') return;
        const key = notice.target === 'projector' ? 'live.modes.itemAddedProjector' : 'live.modes.itemAdded';
        box.textContent = t(key, { name: notice.by || t('live.modes.someone'), title: notice.title || '' });
        box.hidden = false;
        clearTimeout(timer);
        timer = setTimeout(() => { box.hidden = true; }, TOAST_MS);
      },
    };
  }

  window.LIVE_MODES = { controls, toast };
})();
