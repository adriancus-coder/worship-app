'use strict';

// The round "i" next to a page's title (the team page): the explanatory text that used to
// sit under the title as a paragraph opens in a small dialog instead, so the list under it
// starts higher, above all on phones. The text is asked for when the button is tapped (it
// can depend on the page's state, e.g. the open tab, and on the language).
//
//   INFO_TIP.button({ id, label, text })   -> the <button> (class info-button)
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

  window.INFO_TIP = { button, open };
})();
