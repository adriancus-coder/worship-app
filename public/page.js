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

  window.PAGE = { api, el, canEdit, setTitle };
})();
