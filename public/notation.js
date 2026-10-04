'use strict';

// Chord notation for display: letters (C D E) or Romanian solfège (Do Re Mi). Songs are
// always stored with letters; this only changes how chords and keys are shown.
// The user's choice (else the church default) comes from /api/auth/me; switching saves it
// and fires `notation:change` on document so pages re-render in place.
// Switches are placed with <span data-notation-switch></span> or NOTATION.createSwitch().

(function () {
  const STORE_KEY = 'wa_chord_notation';
  const { NOTATIONS, toNotation, renderContent } = window.CHORDS;
  const { t } = window.I18N;
  const switches = new Set();

  function read() {
    try {
      const value = window.localStorage.getItem(STORE_KEY);
      return NOTATIONS.includes(value) ? value : null;
    } catch (err) {
      return null;
    }
  }

  // Remembered locally too, so the first paint already uses it.
  let current = read() || 'letters';

  function remember(value) {
    try {
      window.localStorage.setItem(STORE_KEY, value);
    } catch (err) {
      // Private mode: the server copy still applies on the next page.
    }
  }

  function renderSwitch(group) {
    group.setAttribute('aria-label', t('notation.label'));
    for (const button of group.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.value === current));
      button.setAttribute('aria-label', t(`notation.${button.dataset.value}`));
      button.title = t(`notation.${button.dataset.value}`);
    }
  }

  function set(value, { save = true } = {}) {
    if (!NOTATIONS.includes(value) || value === current) return;
    current = value;
    remember(value);
    switches.forEach((group) => (group.isConnected ? renderSwitch(group) : switches.delete(group)));
    document.dispatchEvent(new CustomEvent('notation:change', { detail: { notation: value } }));
    if (save) {
      fetch('/api/me/chord-notation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notation: value }),
      }).catch(() => {});
    }
  }

  // "C · Do": two 44px buttons, the current one pressed.
  function createSwitch() {
    const group = document.createElement('span');
    group.className = 'notation-switch';
    group.setAttribute('role', 'group');
    for (const [value, text] of [['letters', 'C'], ['solfege', 'Do']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.dataset.value = value;
      button.textContent = text;
      button.addEventListener('click', () => set(value));
      group.append(button);
    }
    switches.add(group);
    renderSwitch(group);
    return group;
  }

  function mount(root = document) {
    for (const slot of root.querySelectorAll('[data-notation-switch]')) {
      slot.replaceWith(createSwitch());
    }
  }

  document.addEventListener('i18n:change', () => switches.forEach(renderSwitch));

  // The effective notation for this user (own choice, else the church default).
  fetch('/api/auth/me', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((me) => {
      if (me && me.user) set(me.user.chordNotation, { save: false });
    })
    .catch(() => {});

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
  else mount();

  window.NOTATION = {
    get: () => current,
    set,
    // A chord or a key ("F#m") in the current notation.
    chord: (chord) => (chord ? toNotation(chord, current) : chord),
    // Inline ChordPro content with its chords in the current notation.
    content: (content) => renderContent(content, current),
    createSwitch,
    mount,
  };
})();
