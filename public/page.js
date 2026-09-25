'use strict';

// Small helpers shared by the signed-in pages.

(function () {
  // fetch() wrapper: JSON in and out; a 401 sends the user to the login page.
  async function api(url, options = {}) {
    const opts = { cache: 'no-store', ...options, headers: { ...(options.headers || {}) } };
    if (opts.body !== undefined && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      window.location.replace('/login');
      return new Promise(() => {});
    }
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  }

  // el('a', { class: 'x', href: '/', text: 'Hi', onclick: fn }, child, ...)
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value') node.value = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function canEdit(me) {
    return Boolean(me && ['owner', 'leader'].includes(me.user.role));
  }

  function setTitle(key, vars) {
    document.title = window.I18N.t(key, { appName: document.documentElement.dataset.appName || '', ...vars });
  }

  // Calendar dates ("2026-10-11") shown in the page language:
  // formatDate(d) -> "Duminică, 11 octombrie" / "Sunday, 11 October" (+ year when not thisYear).
  const LOCALES = { ro: 'ro-RO', en: 'en-GB' };

  function dateParts(dateStr, options) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const locale = LOCALES[window.I18N.lang] || LOCALES.ro;
    const parts = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).formatToParts(new Date(Date.UTC(y, m - 1, d)));
    return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  }

  const capitalize = (s) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

  function formatDate(dateStr, thisYear) {
    const p = dateParts(dateStr, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const base = `${capitalize(p.weekday)}, ${p.day} ${p.month}`;
    return thisYear && String(thisYear) !== p.year ? `${base} ${p.year}` : base;
  }

  // { weekday: "DUM", day: "11", month: "OCT" } for a date block.
  function dateBlock(dateStr) {
    const p = dateParts(dateStr, { weekday: 'short', day: 'numeric', month: 'short' });
    const clean = (s) => s.replace(/\.$/, '').toLocaleUpperCase();
    return { weekday: clean(p.weekday), day: p.day, month: clean(p.month) };
  }

  // ARIA tabs: click and arrow/Home/End keys select; onSelect(index) is called on change.
  function setupTabs(buttons, onSelect) {
    function select(index, focus) {
      buttons.forEach((tab, i) => {
        tab.setAttribute('aria-selected', String(i === index));
        tab.tabIndex = i === index ? 0 : -1;
      });
      if (focus) buttons[index].focus();
      onSelect(index);
    }
    buttons.forEach((tab, i) => {
      tab.addEventListener('click', () => select(i, false));
      tab.addEventListener('keydown', (event) => {
        const visible = buttons.filter((b) => !b.hidden);
        const at = visible.indexOf(tab);
        const moves = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: visible.length - 1 };
        if (!(event.key in moves)) return;
        event.preventDefault();
        const next = visible[(moves[event.key] + visible.length) % visible.length];
        select(buttons.indexOf(next), true);
      });
    });
    return { select };
  }

  window.PAGE = { api, el, canEdit, setTitle, formatDate, dateBlock, setupTabs };
})();
