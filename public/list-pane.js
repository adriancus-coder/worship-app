'use strict';

// List panes (CLAUDE.md "UI rules", styles.css "List pages"): while a .list-pane actually
// scrolls it is a keyboard-focusable region (tabindex="0", role="region", aria-label), so
// Tab reaches it and the arrows / PageDown scroll it; when it does not scroll it is left
// out of the tab order. Panes marked data-list-pane="<i18n key of the label>" attach on
// their own; others: LIST_PANE.attach(element, () => label).

(function () {
  const panes = new Set();

  function update(pane) {
    const scrolls = pane.scrollHeight > pane.clientHeight + 1 && !pane.hidden;
    if (scrolls) {
      pane.tabIndex = 0;
      pane.setAttribute('role', 'region');
      pane.setAttribute('aria-label', pane.paneLabel());
    } else {
      pane.removeAttribute('tabindex');
      pane.removeAttribute('role');
      pane.removeAttribute('aria-label');
    }
  }

  function attach(pane, label) {
    if (!pane || panes.has(pane)) return;
    pane.classList.add('list-pane');
    pane.paneLabel = label;
    panes.add(pane);
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => update(pane));
    };
    if ('ResizeObserver' in window) new ResizeObserver(later).observe(pane);
    new MutationObserver(later).observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', later);
    later();
  }

  function attachAll(root = document) {
    for (const pane of root.querySelectorAll('[data-list-pane]')) {
      attach(pane, () => window.I18N.t(pane.dataset.listPane));
    }
  }

  document.addEventListener('i18n:change', () => panes.forEach(update));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => attachAll());
  else attachAll();

  window.LIST_PANE = { attach, attachAll, update };
})();
