'use strict';

// The round "i" next to a page's title: the explanatory text that used to sit under the
// title as a paragraph opens in a small dialog instead, so the page starts higher, above all
// on phones, and the text no longer takes room once the app is learnt. The text is asked for
// when the button is tapped (it can depend on the page's state, e.g. the open tab, and on
// the language).
//
//   <p class="muted" data-i18n="screens.intro" data-info-tip></p>
//       on load: the paragraph is hidden and the "i" goes next to the page's <h1> (the first
//       one before it); the dialog shows the paragraph's current text (i18n keeps it fresh)
//   INFO_TIP.button({ id, label, text })   -> the <button> (class info-button), for a page
//       whose text depends on its state (the team page's tabs)
//     label   () => the button's aria-label (what the text is about)
//     text    () => the text to show
//   INFO_TIP.open(text)                    -> opens the dialog with that text

(function () {
  let dialog = null;

  function build() {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    dialog = el('dialog', { class: 'info-dialog', id: 'info-dialog', 'aria-labelledby': 'info-dialog-text' });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.append(
      el('p', { id: 'info-dialog-text' }),
      el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'secondary', id: 'info-dialog-close', 'data-icon': 'check', text: t('info.ok'), onclick: () => dialog.close() })));
    document.body.append(dialog);
  }

  function open(text) {
    if (!dialog) build();
    dialog.querySelector('#info-dialog-text').textContent = text;
    dialog.querySelector('#info-dialog-close').textContent = window.I18N.t('info.ok');
    if (!dialog.open) dialog.showModal();
  }

  function button({ id, label, text }) {
    const { el } = window.PAGE;
    const node = el('button', { type: 'button', id: id || null, class: 'secondary info-button', 'data-icon': 'info', onclick: () => open(text()) });
    const name = () => { node.setAttribute('aria-label', label()); node.title = label(); };
    name();
    document.addEventListener('i18n:change', name);
    return node;
  }

  // The declarative form: every [data-info-tip] paragraph becomes an "i" next to the h1.
  function attach() {
    for (const node of document.querySelectorAll('[data-info-tip]')) {
      if (node.dataset.infoTipDone) continue;
      node.dataset.infoTipDone = '1';
      node.hidden = true;
      const h1 = [...document.querySelectorAll('main h1')].reverse().find((h) => h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) || document.querySelector('main h1');
      if (!h1) continue;
      let title = h1.closest('.page-title');
      if (!title) {
        title = document.createElement('div');
        title.className = 'page-title';
        h1.replaceWith(title);
        title.append(h1);
      }
      title.append(button({ label: () => window.I18N.t('info.about', { what: h1.textContent.trim() }), text: () => node.textContent }));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();

  window.INFO_TIP = { button, open, attach };
})();
