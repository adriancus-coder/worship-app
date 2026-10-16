'use strict';

// "Mai mult → Notificări" (a list page: the head and the push row stay, the list pane scrolls):
//   - the push row for this device (public/push-client.js): the state in one line and the one
//     action it needs; the explanation and the iPhone "install first" hint only while push is
//     not on here;
//   - the list by day ("Azi", "Ieri", a date; sticky headings), newest first: an icon for the
//     kind, the title, the text, the time; unread rows carry the accent and a dot. The same
//     news repeated for one event (the setlist changed four times this afternoon) folds into
//     one row with "×4"; a tap marks the whole fold read, then opens its page;
//   - "Ce primești", the per-kind switches, folded at the end of the list.

(function () {
  const { setTitle, api, el, formatDate } = window.PAGE;
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
    const needsInstall = s.ios && !s.standalone && s.enabled;
    $('push-ios').hidden = !needsInstall;
    const can = s.enabled && s.supported && s.permission !== 'denied' && !needsInstall;
    $('push-on').hidden = !can || s.subscribed;
    $('push-off').hidden = !s.subscribed;
    $('push-test').hidden = !s.subscribed;
    $('push-intro').hidden = s.subscribed || !s.enabled; // why turn it on - only while it is off
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

  // --- the list by day and the per-kind switches (lib/notifications.js) --------------------
  const ICONS = { assigned: '📋', invited: '✉️', attendance: '🙋', unassigned: '↩️', reminder: '⏰', setlist_changed: '🎵', accepted: '✅', declined: '❌', unavailable: '🚫', live_started: '▶️', proposal: '💡', proposal_decided: '💬' };
  const list = { items: [], unread: 0, prefs: {}, kinds: [] };
  const locale = () => (window.I18N.lang === 'en' ? 'en-GB' : 'ro-RO');

  // The device's calendar day of a moment ("2026-10-16") and its heading: Azi / Ieri / the date.
  const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function dayLabel(day) {
    const today = dayOf(Date.now());
    if (day === today) return t('notif.today');
    if (day === dayOf(Date.now() - 24 * 60 * 60 * 1000)) return t('notif.yesterday');
    return formatDate(day, today.slice(0, 4));
  }
  const timeOf = (ms) => new Intl.DateTimeFormat(locale(), { timeStyle: 'short' }).format(new Date(ms));

  // Rows in order (newest first), the same news for one event folded into one: { latest, ids, unread, count }.
  function folds(items) {
    const out = [];
    for (const n of items) {
      const last = out[out.length - 1];
      if (last && last.latest.kind === n.kind && last.latest.eventId === n.eventId && last.latest.title === n.title) {
        last.ids.push(n.id);
        last.count += 1;
        last.unread = last.unread || !n.readAt;
      } else out.push({ latest: n, ids: [n.id], count: 1, unread: !n.readAt });
    }
    return out;
  }

  function renderList() {
    $('notif-status').hidden = list.items.length > 0;
    if (!list.items.length) { $('notif-status').removeAttribute('data-i18n'); $('notif-status').textContent = t('notif.listEmpty'); }
    $('notif-read-all').hidden = list.unread === 0;
    const days = new Map();
    for (const fold of folds(list.items)) {
      const day = dayOf(fold.latest.createdAt);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(fold);
    }
    $('notif-list').replaceChildren(...[...days].map(([day, rows]) => el('section', { class: 'notif-day' },
      el('h2', { class: 'pane-heading notif-day-head', text: dayLabel(day) }),
      el('ul', { class: 'notif-list' }, ...rows.map((fold) => {
        const n = fold.latest;
        return el('li', { class: `notif-row${fold.unread ? ' unread' : ''}`, 'data-kind': n.kind, 'data-ids': fold.ids.join(',') },
          el('a', { class: 'notif-link', href: n.url || '/app', onclick: (event) => open(event, fold) },
            el('span', { class: 'notif-icon', 'aria-hidden': 'true', text: ICONS[n.kind] || '🔔' }),
            el('span', { class: 'notif-text' },
              el('span', { class: 'sr-only', text: `${t(`notif.kinds.${n.kind}`)}: ` }),
              el('span', { class: 'notif-title', text: n.title }),
              n.body ? el('span', { class: 'notif-body', text: n.body }) : null),
            el('span', { class: 'notif-meta' },
              el('span', { class: 'notif-time', text: timeOf(n.createdAt) }),
              fold.count > 1 ? el('span', { class: 'notif-count', text: t('notif.times', { n: fold.count }), 'aria-label': t('notif.timesLabel', { n: fold.count }) }) : null,
              el('span', { class: 'notif-dot', 'aria-hidden': 'true' }))));
      })))));
    $('notif-prefs').replaceChildren(...list.kinds.map((kind) => el('label', { class: 'checkbox' },
      el('input', { type: 'checkbox', 'data-kind': kind, checked: list.prefs[kind] ? 'checked' : null, onchange: (event) => savePref(kind, event.target.checked) }),
      el('span', { text: t(`notif.kinds.${kind}`) }))));
  }

  // A tap marks the row (its whole fold) read first - the dot goes, the badges count down -
  // then opens its page.
  async function open(event, fold) {
    if (!fold.unread || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const href = event.currentTarget.href;
    const res = await api('/api/notifications/read', { method: 'POST', body: { ids: fold.ids } }).catch(() => null);
    if (res && res.ok) {
      for (const n of list.items) if (fold.ids.includes(n.id) && !n.readAt) n.readAt = Date.now();
      list.unread = res.body.unread;
      renderList();
      if (window.SHELL && window.SHELL.setUnread) window.SHELL.setUnread(list.unread);
    }
    window.location.assign(href);
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
