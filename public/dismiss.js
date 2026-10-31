'use strict';

// Messages that can be closed: any element with data-dismiss="<id>" (explanatory hints,
// the console's mode banner) gets a × button next to it; closing it hides it on this device
// (localStorage) until "Arată din nou mesajele închise" on the profile page. Elements added
// later (rendered by a script) are picked up by a MutationObserver. The text itself stays
// managed by its page (i18n, live state): only the wrapper is hidden.

(function () {
  const STORE_KEY = 'wa_dismissed';
  let dismissed = read();

  function read() {
    try {
      const list = JSON.parse(window.localStorage.getItem(STORE_KEY) || '[]');
      return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
    } catch (err) {
      return new Set();
    }
  }

  function write() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify([...dismissed]));
    } catch (err) {
      // this page only
    }
  }

  function label() {
    return window.I18N ? window.I18N.t('dismiss.close') : 'Închide';
  }

  function wrap(node) {
    if (node.closest('.dismissable')) return;
    const id = node.dataset.dismiss;
    if (!id) return;
    const box = document.createElement('div');
    box.className = 'dismissable';
    box.dataset.dismissId = id;
    box.hidden = dismissed.has(id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dismiss';
    button.setAttribute('aria-label', label());
    button.title = label();
    button.innerHTML = '<span aria-hidden="true">×</span>';
    button.addEventListener('click', () => {
      dismissed.add(id);
      write();
      box.hidden = true;
      document.dispatchEvent(new CustomEvent('dismiss:change'));
    });
    node.replaceWith(box);
    box.append(node, button);
    // A message its page hides by CSS (a keyboard hint on phones) leaves no stray ×: the
    // wrapper follows the element's rendered size.
    const follow = () => box.classList.toggle('is-empty', node.offsetWidth === 0 && node.offsetHeight === 0);
    if ('ResizeObserver' in window) new ResizeObserver(follow).observe(node);
    follow();
  }

  function attach(root) {
    for (const node of (root || document).querySelectorAll('[data-dismiss]')) wrap(node);
  }

  // "Arată din nou mesajele închise": every message shows again on this device.
  function reset() {
    dismissed = new Set();
    write();
    for (const box of document.querySelectorAll('.dismissable')) box.hidden = false;
    document.dispatchEvent(new CustomEvent('dismiss:change'));
  }

  function count() {
    return dismissed.size;
  }

  function start() {
    attach(document);
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches('[data-dismiss]')) wrap(node);
          attach(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('i18n:change', () => {
    for (const button of document.querySelectorAll('.dismissable > .dismiss')) {
      button.setAttribute('aria-label', label());
      button.title = label();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.DISMISS = { attach, reset, count, STORE_KEY };
})();
