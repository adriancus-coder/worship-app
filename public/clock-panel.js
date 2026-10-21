'use strict';

// The corner-clock controls (public/clock.js) the leader page, the operator console and the
// settings page share: the "Ceas" toggle (key K on the live pages), the corner (a selection
// group of the four corners) and the size (70 - 180 %, step 10, shown as a percentage).
//
//   const panel = CLOCK_PANEL.create(container, { t, el, onChange, prefix, kind });
//   panel.update({ clock, enabled });   // clock: { show, position, scale }; enabled: live
//   panel.toggle();                     // key K: show <-> hidden
//   panel.render();                     // after a language change
// onChange(patch) receives { show } | { position } | { scale } (the live pages send
// clock.set, the settings page saves the church defaults). kind: 'clock' (default) or
// 'key': the same controls for "Gama pe proiector" (key G; labels live.projector.key*;
// key.set / the church defaults).

(function () {
  const { POSITIONS, SCALE_MIN, SCALE_MAX, SCALE_STEP, normalize, normalizeKey } = window.CLOCK;
  const pct = (scale) => Math.round(scale * 100);

  function create(container, { t, el, onChange, prefix = 'clock', kind = 'clock' }) {
    const norm = kind === 'key' ? normalizeKey : normalize;
    const label = (name) => t(`live.projector.${kind === 'key' ? 'key' : 'clock'}${name}`);
    let clock = norm(null);
    let enabled = false;

    const toggle = el('button', {
      type: 'button', class: 'secondary clock-toggle', 'aria-pressed': 'false', 'aria-keyshortcuts': kind === 'key' ? 'G' : 'K',
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
    if (kind === 'key') container.classList.add('key-panel');
    container.replaceChildren(
      el('div', { class: 'clock-row' }, toggle, cornersGroup),
      el('div', { class: 'clock-size' }, sizeLabel, size),
    );

    function render() {
      toggle.textContent = label('');
      toggle.setAttribute('aria-label', label('Label'));
      toggle.setAttribute('aria-pressed', String(enabled && clock.show));
      toggle.disabled = !enabled;
      cornersGroup.setAttribute('aria-label', label('Position'));
      for (const button of corners) {
        const name = t(`live.projector.corners.${button.dataset.corner}`);
        button.setAttribute('aria-label', name);
        button.title = name;
        button.setAttribute('aria-pressed', String(enabled && button.dataset.corner === clock.position));
        button.disabled = !enabled;
      }
      sizeText.textContent = label('Size');
      size.value = String(pct(clock.scale));
      sizeValue.textContent = `${pct(clock.scale)} %`;
      size.disabled = !enabled;
    }

    render();
    return {
      update(next) {
        clock = norm(next && next.clock);
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

  // "Acorduri" on the projector: one selection toggle (aria-pressed; key C on the live pages).
  //   const toggle = CHORDS_TOGGLE.create(container, { t, el, onChange(show) });
  //   toggle.update({ show, enabled }); toggle.toggle(); toggle.render();
  function createChordsToggle(container, { t, el, onChange }) {
    let show = false;
    let enabled = false;
    const button = el('button', { type: 'button', class: 'secondary chords-toggle', 'aria-pressed': 'false', 'aria-keyshortcuts': 'C', onclick: () => { if (enabled) onChange(!show); } });
    container.replaceChildren(button);
    function render() {
      button.textContent = t('live.projector.chords');
      button.setAttribute('aria-label', t('live.projector.chordsLabel'));
      button.setAttribute('aria-pressed', String(enabled && show));
      button.disabled = !enabled;
    }
    render();
    return {
      update(next) { show = Boolean(next && next.show); enabled = Boolean(next && next.enabled); render(); },
      toggle() { if (enabled) onChange(!show); },
      render,
    };
  }
  window.CHORDS_TOGGLE = { create: createChordsToggle };
})();
