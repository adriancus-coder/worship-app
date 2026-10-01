'use strict';

// The projector controls the leader page and the operator console share:
//   "Proiectorul: Ion (operator)"  who holds it, with "Cere controlul proiectorului" (anyone
//                                  else) or "Predă controlul proiectorului" (the holder: a
//                                  list of the event-role people connected)
//   "Echipa: Urmărește live · Derulează liber"  team.mode follow | free
// the request flow around them (a request waits for a connected holder: Acceptă / Refuză on
// the holder's page; with the holder away it applies at once; whoever gets the projector is
// told that what they change shows in church: lib/live.js; an owner may always answer, on
// whatever page they have open), and the short info toast for
// additions made by someone else ("<name> a adăugat …"): it hides after 5 s and never takes
// clicks.
//
//   const modes = LIVE_MODES.controls(container, { send, t, el });
//   modes.setMe(user);                       // who this page is (role, id)
//   modes.update(snap);                      // hidden until the event is live (snap.holder, snap.presence.people)
//   modes.handover(event);                   // socket 'live:handover'
//   modes.statusText();                      // for the big lyrics' status line
//   const toast = LIVE_MODES.toast(box, { t });
//   socket.on('live:notice', toast.show);
//
// Requester: "Cerere trimisă… 58 s" with "Anulează" while pending, "<X> a refuzat" for 5 s
// after a refusal; on accept the page says for 8 s "<X> a acceptat: ai proiectorul. Ce schimbi
// aici apare pe proiector" - the same when the holder hands it over or someone takes it with
// the holder away. Holder: a toast "<X> cere controlul proiectorului" with Acceptă (primary,
// Enter when focused) / Refuză that never covers the step grid, and a badge on the row.

(function () {
  const TOAST_MS = 5000;
  const ANSWER_MS = 5000;
  const NOTICE_MS = 8000; // "ce schimbi aici apare pe proiector"

  function controls(container, { send, t, el }) {
    let snap = null;
    let me = null;
    let pickOpen = false;
    const hand = { answer: null, timer: null, askedBy: null }; // answer: { type, until, name }
    // "Proiectorul: <holder>" + the one action this page has (request / hand over).
    const holderLabel = el('span', { class: 'mode-label', id: 'holder-label' });
    const holderText = el('strong', { class: 'holder-text', id: 'holder-text' });
    const action = el('button', { type: 'button', class: 'secondary', id: 'projector-action', 'data-icon': 'projector', onclick: () => onAction() });
    const badge = el('span', { class: 'handover-badge', hidden: true });
    const holderRow = el('div', { class: 'mode-row holder-row' }, holderLabel, holderText, action, badge);
    // The holder's list: "Predă lui <name> (<role>)" for every other event-role person connected.
    const pick = el('div', { class: 'handover-pick', role: 'group', 'aria-labelledby': 'projector-action', hidden: true });
    const segmented = (labelKey, command, values) => {
      const label = el('span', { class: 'mode-label' });
      const buttons = values.map((value) => el('button', {
        type: 'button',
        class: 'secondary',
        'data-value': value,
        'aria-pressed': 'false',
        onclick: () => { if ((snap && snap.teamMode) !== value) send(command, { mode: value }); },
      }));
      const group = el('div', { class: 'mode-switch', role: 'group' }, ...buttons);
      const row = el('div', { class: 'mode-row' }, label, group);
      return { row, label, group, buttons, labelKey, command, values };
    };
    const teamMode = segmented('live.modes.teamLabel', 'team.mode', ['follow', 'free']);
    const hint = el('p', { class: 'hint mode-hint' });
    // The requester's line: "Cerere trimisă… 58 s" + Anulează, or the answer / the notice.
    const lineText = el('p');
    const cancel = el('button', { type: 'button', class: 'secondary', onclick: () => send('handover.cancel') });
    const line = el('div', { class: 'handover-line', role: 'status', 'aria-live': 'polite', hidden: true }, lineText, cancel);
    container.classList.add('mode-controls');
    container.replaceChildren(holderRow, pick, teamMode.row, hint, line);
    // The holder's toast, on the page body so it floats over nothing important.
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
    const holder = () => (live() && snap.holder) || null;
    const isHolder = () => Boolean(me && holder() && holder().userId === me.id);
    const pending = () => (live() && snap.handover && snap.handover.expiresAt > Date.now() ? snap.handover : null);
    const mine = () => Boolean(pending() && me && pending().requestedBy === me.id);
    // The holder answers; an owner always may (not their own request).
    const canAnswer = () => Boolean(me && (isHolder() || (me.role === 'owner' && !mine())));
    const secondsLeft = () => Math.max(0, Math.ceil((pending().expiresAt - Date.now()) / 1000));
    const roleName = (role) => (role ? t(`team.roles.${role}`) : '');
    const personLabel = (p) => `${p.name || t('live.modes.someone')} (${roleName(p.role)})`;
    const holderName = () => (holder() ? holder().name || t('live.modes.someone') : t('live.modes.nobody'));
    // The other event-role people connected (from the presence), for "Predă lui …".
    const others = () => (((snap && snap.presence && snap.presence.people) || []).filter((p) => !me || p.userId !== me.id));

    function onAction() {
      if (!live()) return;
      if (isHolder()) {
        pickOpen = !pickOpen;
        render();
        return;
      }
      send('projector.request');
    }

    function tick() {
      clearTimeout(hand.timer);
      hand.timer = null;
      const p = pending();
      if (hand.answer && hand.answer.until <= Date.now()) hand.answer = null;
      if (p && mine()) lineText.textContent = t('live.modes.handoverSent', { s: secondsLeft() });
      if (p || hand.answer) hand.timer = setTimeout(() => { tick(); if (!pending()) render(); }, 1000);
      if (!p && !hand.answer) render();
    }

    // The line after an answer or a change of hands.
    function answerText(answer) {
      const name = answer.name || t('live.modes.someone');
      return t(`live.modes.handover${answer.type[0].toUpperCase()}${answer.type.slice(1)}`, { name });
    }

    // The text the big lyrics' status line shows for the request flow, or ''.
    function statusText() {
      if (!live()) return '';
      const p = pending();
      if (p && mine()) return t('live.modes.handoverSent', { s: secondsLeft() });
      if (p && canAnswer()) return t('live.modes.handoverAsk', { name: hand.askedBy || t('live.modes.someone') });
      if (hand.answer && hand.answer.until > Date.now()) return answerText(hand.answer);
      return '';
    }

    function render() {
      container.hidden = !live();
      toast.hidden = true;
      if (!live()) {
        line.hidden = true;
        pick.hidden = true;
        return;
      }
      const h = holder();
      holderLabel.textContent = t('live.modes.label');
      holderText.textContent = h ? personLabel(h) : t('live.modes.nobody');
      const p = pending();
      // the action: the holder hands over, everyone else asks
      action.hidden = !me;
      action.textContent = t(isHolder() ? 'live.modes.handOver' : 'live.modes.request');
      action.setAttribute('aria-label', action.textContent);
      if (isHolder()) {
        action.setAttribute('aria-expanded', String(pickOpen));
        action.disabled = others().length === 0;
      } else {
        action.removeAttribute('aria-expanded');
        action.disabled = Boolean(p && mine());
        pickOpen = false;
      }
      pick.hidden = !(isHolder() && pickOpen);
      if (!pick.hidden) {
        pick.replaceChildren(...others().map((person) => el('button', {
          type: 'button', class: 'secondary', 'data-icon': 'projector', 'data-to': String(person.userId),
          text: t('live.modes.handTo', { name: personLabel(person) }),
          onclick: () => { pickOpen = false; send('projector.handover', { toUserId: person.userId }); },
        })));
      }
      // the team switch
      teamMode.label.id = 'team-mode-label';
      teamMode.label.textContent = t(teamMode.labelKey);
      teamMode.group.setAttribute('aria-labelledby', 'team-mode-label');
      for (const button of teamMode.buttons) {
        button.textContent = t(`live.modes.${button.dataset.value}`);
        button.setAttribute('aria-pressed', String(button.dataset.value === snap.teamMode));
      }
      // what the projector follows, for this page
      const name = holderName();
      if (isHolder()) hint.textContent = t(snap.mode === 'split' ? 'live.modes.holderSplitHint' : 'live.modes.holderTogetherHint');
      else hint.textContent = t(snap.mode === 'split' ? 'live.modes.otherSplitHint' : 'live.modes.otherTogetherHint', { name });
      if (isHolder() && others().length === 0) hint.textContent += ` ${t('live.modes.nobodyElse')}`;
      // the requester's line
      const answer = hand.answer && hand.answer.until > Date.now() ? hand.answer : null;
      line.hidden = !(p && mine()) && !answer;
      line.classList.toggle('refused', Boolean(answer && answer.type === 'refused'));
      cancel.hidden = !(p && mine());
      cancel.textContent = t('live.modes.handoverCancel');
      if (p && mine()) lineText.textContent = t('live.modes.handoverSent', { s: secondsLeft() });
      else if (answer) lineText.textContent = answerText(answer);
      // the holder's badge and toast
      const asked = Boolean(p && canAnswer());
      badge.hidden = !asked;
      badge.textContent = t('live.modes.handoverBadge');
      holderRow.classList.toggle('pending', asked);
      toast.hidden = !asked;
      if (asked) {
        toastText.textContent = t('live.modes.handoverAsk', { name: hand.askedBy || t('live.modes.someone') });
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
      // socket 'live:handover': { type: requested | accepted | refused | cancelled | handedOver | taken,
      // by, byUserId, to?, toUserId? }
      handover(event) {
        if (!event || !snap) return;
        const actor = Boolean(me && event.byUserId === me.id);
        const receiver = Boolean(me && event.toUserId !== undefined && event.toUserId === me.id);
        const notice = (type, name) => { hand.answer = { type, name: name || null, until: Date.now() + NOTICE_MS }; };
        if (event.type === 'requested') {
          hand.askedBy = event.by || null;
          hand.answer = null;
          // The toast takes focus so Enter accepts, unless someone is typing.
          if (canAnswer() && !(document.activeElement && document.activeElement.closest('input, textarea, select, dialog[open]'))) {
            setTimeout(() => { if (!toast.hidden) accept.focus(); }, 0);
          }
        } else if (event.type === 'refused') {
          // Shown to the one who asked.
          const wasMine = Boolean(me && (event.requestedBy === me.id || mine()));
          hand.answer = wasMine ? { type: 'refused', name: event.by || null, until: Date.now() + ANSWER_MS } : null;
        } else if (event.type === 'accepted' || event.type === 'handedOver') {
          // The projector changed hands (the snapshot follows): the one who got it is told what
          // that means; the others who it went to; the one who gave it nothing.
          if (receiver) notice(event.type === 'accepted' ? 'accepted' : 'received', event.by);
          else if (!actor) notice('nowHolds', event.to);
          else hand.answer = null;
        } else if (event.type === 'taken') {
          if (actor) notice('taken', null);
          else notice('takenBy', event.by);
        } else if (event.type === 'cancelled') hand.answer = null;
        render();
      },
      statusText,
      render,
    };
  }

  // onProposal(action, proposal): 'setlist' | 'projector' | 'decline' for a song proposal toast
  // ("X propune: <title>"), which stays until answered or closed (never over the step grid:
  // the toast box sits top right).
  function toast(box, { t, el, onProposal }) {
    let timer = null;
    box.classList.add('info-toast');
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.hidden = true;
    const hide = () => { box.hidden = true; box.classList.remove('proposal-toast'); box.replaceChildren(); };
    return {
      show(notice) {
        if (!notice) return;
        if (notice.type === 'proposal' && el && onProposal) {
          const p = notice.proposal || {};
          const action = (label, icon, value, primary) => el('button', { type: 'button', class: primary ? '' : 'secondary', 'data-icon': icon, 'data-proposal-action': value, text: label, onclick: () => { hide(); onProposal(value, p); } });
          box.replaceChildren(
            el('p', { class: 'proposal-toast-text' }, el('strong', { text: t('proposals.toast', { name: notice.by || t('live.modes.someone'), title: p.songTitle || '' }) }), p.note ? el('span', { class: 'muted', text: ` · ${p.note}` }) : null),
            el('div', { class: 'proposal-toast-actions' },
              action(t('proposals.addSetlist'), 'plus', 'setlist', true),
              action(t('proposals.addProjector'), 'projector', 'projector', false),
              action(t('proposals.decline'), 'close', 'decline', false)),
            el('button', { type: 'button', class: 'secondary proposal-toast-close', 'aria-label': t('shell.close'), onclick: hide }, el('span', { 'aria-hidden': 'true', text: '✕' })));
          box.classList.add('proposal-toast');
          box.hidden = false;
          clearTimeout(timer);
          return;
        }
        if (notice.type !== 'itemAdded') return;
        box.classList.remove('proposal-toast');
        const key = notice.target === 'projector' ? 'live.modes.itemAddedProjector' : 'live.modes.itemAdded';
        box.textContent = t(key, { name: notice.by || t('live.modes.someone'), title: notice.title || '' });
        box.hidden = false;
        clearTimeout(timer);
        timer = setTimeout(hide, TOAST_MS);
      },
      hide,
    };
  }

  window.LIVE_MODES = { controls, toast };
})();
