'use strict';

// A tab row that scrolls sideways (the event's tabs on a phone) says so: while more tabs hide
// past an edge, that edge fades (styles.css .tabs[data-overflow]). Every [role="tablist"]
// whose content is wider than it is watched; a row that fits shows no fade.
//
//   data-overflow = "right" | "left" | "both"   (absent when everything is in view)

(function () {
  function update(row) {
    const more = row.scrollWidth - row.clientWidth > 2;
    const left = more && row.scrollLeft > 2;
    const right = more && row.scrollLeft + row.clientWidth < row.scrollWidth - 2;
    const value = left && right ? 'both' : left ? 'left' : right ? 'right' : '';
    if (value) row.dataset.overflow = value;
    else delete row.dataset.overflow;
  }

  function watch(row) {
    if (row.dataset.scrollTabs) return;
    row.dataset.scrollTabs = '1';
    row.addEventListener('scroll', () => update(row), { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(() => update(row)).observe(row);
    if ('MutationObserver' in window) new MutationObserver(() => update(row)).observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    update(row);
  }

  function attach() {
    document.querySelectorAll('[role="tablist"]').forEach(watch);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
  window.addEventListener('resize', () => document.querySelectorAll('[role="tablist"][data-scroll-tabs]').forEach(update));
  window.SCROLL_TABS = { attach, update };
})();
