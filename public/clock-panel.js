'use strict';

// The corner-clock controls (public/clock.js) the leader page, the operator console and the
// settings page share: the "Ceas" toggle (key K on the live pages), the corner (a selection
// group of the four corners) and the size (70 - 180 %, step 10, shown as a percentage).
//
//   const panel = CLOCK_PANEL.create(container, { t, el, onChange, prefix });
//   panel.update({ clock, enabled });   // clock: { show, position, scale }; enabled: live
//   panel.toggle();                     // key K: show <-> hidden
//   panel.render();                     // after a language change
// onChange(patch) receives { show } | { position } | { scale } (the live pages send
// clock.set, the settings page saves the church defaults).

(function () {
  const { POSITIONS, SCALE_MIN, SCALE_MAX, SCALE_STEP, normalize } = window.CLOCK;
  const pct = (scale) => Math.round(scale * 100);

  function create(container, { t, el, onChange, prefix = 'clock' }) {
    let clock = normalize(null);
    let enabled = false;

    const toggle = el('button', {
      type: 'button', class: 'secondary clock-toggle', 'aria-pressed': 'false', 'aria-keyshortcuts': 'K',
      onclick: () => onChange({ show: !clock.show }),
    });
    const corners = POSITIONS.map((position) => el('button', {
      type: 'button', 'data-corner': position, 'aria-pressed': 'false',
      text: { 'top-left': '↖', 'top-right': '↗', 'bottom-left': '↙', 'bottom-right': '↘' }[position],
      onclick: () => { if (position !== clock.position) onChange({ position }); },
    }));
    const cornersGroup = el('div', { class: 'choice-group clock-corners', role: 'group' }, ...corners);
    const sizeLabel = el('label', { for: `${prefix}-scale` });
    const sizeText = el('span');
    const sizeValue = el('output', { for: `${prefix}-scale`, class: 'clock-size-value' });
    sizeLabel.append(sizeText, ' ', sizeValue);
    const size = el('input', {
      type: 'range', id: `${prefix}-scale`, min: String(pct(SCALE_MIN)), max: String(pct(SCALE_MAX)), step: String(pct(SCALE_STEP)),
      oninput: () => { sizeValue.textContent = `${size.value} %`; }, // live readout while dragging
      onchange: () => {
        const scale = Number(size.value) / 100;
        if (scale !== clock.scale) onChange({ scale });
      },
    });
    container.classList.add('clock-panel');
    container.replaceChildren(
      el('div', { class: 'clock-row' }, toggle, cornersGroup),
      el('div', { class: 'clock-size' }, sizeLabel, size),
    );

    function render() {
      toggle.textContent = t('live.projector.clock');
      toggle.setAttribute('aria-label', t('live.projector.clockLabel'));
      toggle.setAttribute('aria-pressed', String(enabled && clock.show));
      toggle.disabled = !enabled;
      cornersGroup.setAttribute('aria-label', t('live.projector.clockPosition'));
      for (const button of corners) {
        const name = t(`live.projector.corners.${button.dataset.corner}`);
        button.setAttribute('aria-label', name);
        button.title = name;
        button.setAttribute('aria-pressed', String(enabled && button.dataset.corner === clock.position));
        button.disabled = !enabled;
      }
      sizeText.textContent = t('live.projector.clockSize');
      size.value = String(pct(clock.scale));
      sizeValue.textContent = `${pct(clock.scale)} %`;
      size.disabled = !enabled;
    }

    render();
    return {
      update(next) {
        clock = normalize(next && next.clock);
        enabled = Boolean(next && next.enabled);
        render();
      },
      toggle() {
        if (enabled) onChange({ show: !clock.show });
      },
      render,
    };
  }

  window.CLOCK_PANEL = { create };
})();
