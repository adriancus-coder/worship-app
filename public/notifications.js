'use strict';

// "Mai mult → Notificări": the push switch for this device (public/push-client.js) with a plain
// explanation and the iPhone "install first" hint; the in-app list mounts under #notif-list-root
// (the notifications module).

(function () {
  const { setTitle } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  let status = null;

  function say(text, kind) {
    $('push-message').className = `message${kind ? ` ${kind}` : ''}`;
    $('push-message').textContent = text || '';
  }

  function render() {
    setTitle('notif.pageTitle');
    if (!status) return;
    const s = status;
    let key = 'notif.stateOff';
    if (!s.enabled) key = 'notif.stateServerOff';
    else if (!s.supported) key = 'notif.stateUnsupported';
    else if (s.permission === 'denied') key = 'notif.stateDenied';
    else if (s.subscribed) key = 'notif.stateOn';
    $('push-state').textContent = t(key);
    $('push-state').dataset.state = key.replace('notif.state', '').toLowerCase();
    // iPhone / iPad: push works only in the installed app (iOS 16.4+), so say "install first".
    $('push-ios').hidden = !(s.ios && !s.standalone && s.enabled);
    const can = s.enabled && s.supported && s.permission !== 'denied' && !(s.ios && !s.standalone);
    $('push-on').hidden = !can || s.subscribed;
    $('push-off').hidden = !s.subscribed;
    $('push-test').hidden = !s.subscribed;
  }

  async function refresh() {
    status = await window.PUSH.status();
    render();
  }

  $('push-on').addEventListener('click', async () => {
    $('push-on').disabled = true;
    say('');
    const out = await window.PUSH.subscribe();
    $('push-on').disabled = false;
    if (out.ok) say(t('notif.pushEnabled'), 'success');
    else say(t(`notif.pushFailed.${out.reason}`), 'error');
    await refresh();
  });
  $('push-off').addEventListener('click', async () => {
    await window.PUSH.unsubscribe();
    say(t('notif.pushDisabled'), 'success');
    await refresh();
  });
  $('push-test').addEventListener('click', async () => {
    $('push-test').disabled = true;
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      say(res.ok ? t('notif.pushTestSent', { n: body.sent }) : body.error || t('common.networkError'), res.ok ? 'success' : 'error');
    } finally {
      $('push-test').disabled = false;
    }
  });

  // --- the in-app list and the per-kind switches (lib/notifications.js) ----------------------
  const { api, el } = window.PAGE;
  const list = { items: [], unread: 0, prefs: {}, kinds: [] };

  function when(ms) {
    return new Intl.DateTimeFormat(window.I18N.lang === 'en' ? 'en-GB' : 'ro-RO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
  }

  function renderList() {
    $('notif-status').hidden = list.items.length > 0;
    if (!list.items.length) { $('notif-status').removeAttribute('data-i18n'); $('notif-status').textContent = t('notif.listEmpty'); }
    $('notif-read-all').hidden = list.unread === 0;
    $('notif-list').replaceChildren(...list.items.map((n) => el('li', { class: `notif-row${n.readAt ? '' : ' unread'}`, 'data-kind': n.kind },
      el('a', { class: 'notif-link', href: n.url || '/app', onclick: () => { if (!n.readAt) api('/api/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {}); } },
        el('span', { class: 'notif-dot', 'aria-hidden': 'true' }),
        el('span', { class: 'notif-text' },
          el('span', { class: 'notif-title', text: n.title }),
          n.body ? el('span', { class: 'notif-body', text: n.body }) : null,
          el('span', { class: 'notif-when', text: `${t(`notif.kinds.${n.kind}`)} · ${when(n.createdAt)}` }))))));
    $('notif-prefs').replaceChildren(...list.kinds.map((kind) => el('label', { class: 'checkbox' },
      el('input', { type: 'checkbox', 'data-kind': kind, checked: list.prefs[kind] ? 'checked' : null, onchange: (event) => savePref(kind, event.target.checked) }),
      el('span', { text: t(`notif.kinds.${kind}`) }))));
  }

  async function savePref(kind, enabled) {
    const res = await api('/api/notifications/prefs', { method: 'PUT', body: { [kind]: enabled } });
    const out = $('prefs-message');
    out.className = `message ${res.ok ? 'success' : 'error'}`;
    out.textContent = res.ok ? t('notif.prefsSaved') : res.body.error || t('common.networkError');
    if (res.ok) list.prefs = res.body.prefs;
  }

  $('notif-read-all').addEventListener('click', async () => {
    const res = await api('/api/notifications/read', { method: 'POST', body: { all: true } });
    if (!res.ok) return;
    await loadList();
    if (window.SHELL && window.SHELL.setUnread) window.SHELL.setUnread(0);
  });

  async function loadList() {
    const res = await api('/api/notifications');
    if (!res.ok) { $('notif-status').removeAttribute('data-i18n'); $('notif-status').textContent = res.body.error || t('common.networkError'); return; }
    Object.assign(list, { items: res.body.notifications, unread: res.body.unread, prefs: res.body.prefs, kinds: res.body.kinds });
    renderList();
  }

  document.addEventListener('i18n:change', () => { render(); say(''); renderList(); });
  refresh().catch(() => say(t('common.networkError'), 'error'));
  loadList().catch(() => {});
})();
