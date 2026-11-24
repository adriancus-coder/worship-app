'use strict';

// "Doar text": the lyrics without their chords, one choice for the whole app on this device
// (localStorage wa_text_only, read by the song page, the live page, the event page, the big
// lyrics, the follow page, the arrange sheet and the whole-programme view). A change anywhere
// tells every open view on the page (document event textonly:change, detail: true | false).
//
//   TEXT_ONLY.get()            -> true while the lyrics show without chords
//   TEXT_ONLY.set(value)       -> stores it and tells the page
//   TEXT_ONLY.button({ t, el, class }) -> the toggle (secondary, aria-pressed), kept in step

(function () {
  const KEY = 'wa_text_only';

  function get() {
    try { return window.localStorage.getItem(KEY) === '1'; } catch (err) { return false; }
  }

  // Always tells the page (a view that wrote the key itself still calls this for the others).
  function set(value) {
    const next = Boolean(value);
    try { window.localStorage.setItem(KEY, next ? '1' : '0'); } catch (err) { /* this page only */ }
    document.dispatchEvent(new CustomEvent('textonly:change', { detail: next }));
  }

  function button({ t, el, class: extra = '', id = null } = {}) {
    t = t || window.I18N.t;
    el = el || window.PAGE.el;
    const node = el('button', { type: 'button', id, class: `secondary text-only-toggle${extra ? ` ${extra}` : ''}`, 'aria-pressed': String(get()), onclick: () => set(!get()) });
    const render = () => { node.textContent = t('song.textOnly'); node.setAttribute('aria-pressed', String(get())); };
    render();
    document.addEventListener('textonly:change', render);
    document.addEventListener('i18n:change', render);
    return node;
  }

  window.TEXT_ONLY = { get, set, button, KEY };
})();
