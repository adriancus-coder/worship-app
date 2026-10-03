'use strict';

// "Pe ce ecrane" (the leader's live page, the operator console): which of the church's
// screens show the projection of the live event. A selection control (one option per
// screen, aria-pressed): every screen is selected at the start; a tap takes a screen out
// (it shows the idle screen meanwhile) or puts it back. Live state `screens` (lib/live.js,
// command projector.screens: null = every screen, else ids), so every page agrees. Hidden
// while the church has fewer than two screens: there is nothing to choose then.
//
//   const picker = SCREEN_PICKER.create(container, { send, t, el });
//   picker.setScreens(list);   // [{ id, name, online }] from projector:watch / projector:screens
//   picker.update(snap);       // the live snapshot (snap.screens, snap.status)

(function () {
  function create(container, { send, t, el }) {
    let list = [];
    let snap = null;
    const label = el('span', { class: 'mode-label', id: 'screen-picker-label' });
    const group = el('div', { class: 'choice-group screen-picker-group', role: 'group', 'aria-labelledby': 'screen-picker-label' });
    const hint = el('p', { class: 'hint screen-picker-hint' });
    container.classList.add('screen-picker');
    container.hidden = true;
    container.replaceChildren(label, group, hint);

    const live = () => Boolean(snap) && snap.status === 'live';
    const planned = () => Boolean(snap) && snap.status === 'planned'; // prepared before the start
    const editable = () => live() || planned();
    // null in the state = every screen; here always the explicit ids.
    const selected = () => (snap && Array.isArray(snap.screens) ? snap.screens : list.map((s) => s.id));

    function toggle(id) {
      if (!editable()) return;
      const current = selected();
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id].sort((a, b) => a - b);
      const all = list.every((s) => next.includes(s.id));
      // shown at once (two quick taps build on each other); the next snapshot confirms it
      snap = { ...snap, screens: all ? null : next };
      render();
      send('projector.screens', { screenIds: all ? null : next });
    }

    function render() {
      container.hidden = list.length < 2;
      if (container.hidden) return;
      label.textContent = t('live.projector.targetsLabel');
      const chosen = selected();
      group.replaceChildren(...list.map((s) => el('button', {
        type: 'button',
        class: 'secondary',
        'data-screen': String(s.id),
        'aria-pressed': String(chosen.includes(s.id)),
        'aria-label': `${s.name} · ${t(s.online ? 'screens.online' : 'screens.offline')}`,
        disabled: editable() ? null : 'disabled',
        onclick: () => toggle(s.id),
      }, el('span', { class: `online-dot${s.online ? ' on' : ''}`, 'aria-hidden': 'true' }), el('span', { text: s.name }))));
      hint.textContent = !editable() ? t('live.projector.targetsNotLive') : chosen.length === 0 ? t('live.projector.targetsNone') : t(live() ? 'live.projector.targetsHint' : 'live.projector.targetsPrep');
    }

    return {
      setScreens(screens) {
        list = Array.isArray(screens) ? screens : [];
        render();
      },
      update(next) {
        snap = next || null;
        render();
      },
    };
  }

  window.SCREEN_PICKER = { create };
})();
