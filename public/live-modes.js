'use strict';

// The live-mode controls the leader page and the operator console share:
//   "Împreună · Separat"                    live.mode together | split
//   "Echipa: Urmărește live · Derulează liber"  team.mode follow | free
// and the short info toast for additions made by someone else ("<name> a adăugat …"): it
// hides after 5 s and never takes clicks, so it cannot cover a control.
//
//   const modes = LIVE_MODES.controls(container, { send, t, el });
//   modes.update(snap);                      // hidden until the event is live
//   const toast = LIVE_MODES.toast(box, { t });
//   socket.on('live:notice', toast.show);

(function () {
  const TOAST_MS = 5000;

  function controls(container, { send, t, el }) {
    let snap = null;
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
      const row = el('div', { class: 'mode-row' }, label, group);
      return { row, label, group, buttons, labelKey, command, values };
    };
    const liveMode = segmented('live.modes.label', 'live.mode', ['together', 'split']);
    const teamMode = segmented('live.modes.teamLabel', 'team.mode', ['follow', 'free']);
    const hint = el('p', { class: 'hint mode-hint' });
    container.classList.add('mode-controls');
    container.replaceChildren(liveMode.row, teamMode.row, hint);

    function render() {
      const live = Boolean(snap) && snap.status === 'live';
      container.hidden = !live;
      if (!live) return;
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
      hint.textContent = t(snap.mode === 'split' ? 'live.modes.splitHint' : 'live.modes.togetherHint');
    }

    return {
      update(next) {
        snap = next;
        render();
      },
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
