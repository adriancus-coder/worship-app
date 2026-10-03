'use strict';

// The colour theme, before the first paint: loaded in <head> without defer (after the
// stylesheet), on every page. The server renders <html data-theme-pref="dark|light|auto">
// (lib/theme.js); 'auto' follows the device (prefers-color-scheme) and changes live.
// data-theme on <html> selects the palette in public/styles.css; the browser / status bar
// colour (<meta name="theme-color">) follows the page background.
//
//   window.THEME.set('light')   // applies a new preference at once (the caller saves it)
//   window.THEME.pref / .current
//   document 'theme:change' { detail: { pref, theme } }

(function () {
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  const prefOf = () => (['dark', 'light', 'auto'].includes(root.dataset.themePref) ? root.dataset.themePref : 'dark');
  const resolve = (pref) => (pref === 'auto' ? (media && media.matches ? 'light' : 'dark') : pref);

  function apply() {
    const pref = prefOf();
    const theme = resolve(pref);
    const changed = root.dataset.theme !== theme;
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const color = getComputedStyle(root).getPropertyValue('--background').trim();
      if (color) meta.setAttribute('content', color);
    }
    if (changed) document.dispatchEvent(new CustomEvent('theme:change', { detail: { pref, theme } }));
  }

  apply();
  if (media) {
    const onChange = () => { if (prefOf() === 'auto') apply(); };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }

  // Live, console and follow pages (<body data-stage>) in the light theme: once, a small
  // dismissible hint that the dark theme suits the stage better.
  const HINT_KEY = 'wa_stage_theme_hint';
  function hintSeen() {
    try {
      return window.localStorage.getItem(HINT_KEY) === '1';
    } catch (err) {
      return false;
    }
  }
  function stageHint() {
    const body = document.body;
    if (!body || !body.hasAttribute('data-stage') || !window.I18N) return;
    let box = document.getElementById('stage-hint');
    if (root.dataset.theme !== 'light' || hintSeen()) {
      if (box) box.hidden = true;
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.id = 'stage-hint';
      box.className = 'stage-hint';
      box.setAttribute('role', 'note');
      const text = document.createElement('p');
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'secondary';
      close.dataset.icon = 'close';
      close.addEventListener('click', () => {
        try {
          window.localStorage.setItem(HINT_KEY, '1');
        } catch (err) {
          // no storage: hidden for this page only
        }
        box.hidden = true;
      });
      box.append(text, close);
      (document.querySelector('main') || body).prepend(box);
    }
    box.firstChild.textContent = window.I18N.t('theme.stageHint');
    box.lastChild.textContent = window.I18N.t('theme.stageHintClose');
    box.hidden = false;
  }
  document.addEventListener('DOMContentLoaded', stageHint);
  document.addEventListener('theme:change', stageHint);
  document.addEventListener('i18n:change', stageHint);

  window.THEME = {
    set(pref) {
      root.dataset.themePref = pref;
      apply();
    },
    get pref() { return prefOf(); },
    get current() { return root.dataset.theme; },
  };
})();
