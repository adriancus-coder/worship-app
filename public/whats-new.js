'use strict';

// "Ce e nou" after an update (loaded by public/shell.js on every menu page): the releases
// newer than the last one seen on this device (wa_whats_new_seen) open as a pop-up - a date,
// a title, the short list - with "Am înțeles". A device that never saw one (the feature is
// new, or a fresh install) sees the newest release once. Never over another pop-up: it waits
// for it to close. The list can be reopened from the menu ("Ce e nou").

(function () {
  const { api, el, formatDate } = window.PAGE;
  const { t } = window.I18N;
  const SEEN_KEY = 'wa_whats_new_seen';
  // One pop-up at a time (shared with public/answer-popup.js): whoever sets busy shows.
  const gate = window.POPUP_GATE = window.POPUP_GATE || { busy: false };
  let dialog = null;
  let data = null;

  const seen = () => { try { return localStorage.getItem(SEEN_KEY) || null; } catch { return null; } };
  const markSeen = (id) => { try { localStorage.setItem(SEEN_KEY, id); } catch { /* this page only */ } };

  function build() {
    dialog = el('dialog', { class: 'whats-new', id: 'whats-new', 'aria-labelledby': 'whats-new-title' });
    document.body.append(dialog);
  }

  function show(releases, { all = false } = {}) {
    if (!dialog) build();
    const done = () => {
      if (data && data.latest) markSeen(data.latest);
      dialog.close();
      gate.busy = false;
      if (window.ANSWER_POPUP) window.ANSWER_POPUP.check(); // the next pop-up, if any
    };
    gate.busy = true;
    dialog.onkeydown = (event) => { if (event.key === 'Escape') { event.preventDefault(); done(); } };
    dialog.replaceChildren(
      el('p', { class: 'answer-popup-kicker', text: t('whatsNew.kicker') }),
      el('h2', { id: 'whats-new-title', text: all ? t('whatsNew.allTitle') : releases[0].title }),
      ...releases.map((r, i) => el('section', { class: 'whats-new-release' },
        all || i > 0 ? el('h3', { text: r.title }) : null,
        el('p', { class: 'whats-new-date', text: formatDate(r.id, String(new Date().getFullYear())) }),
        el('ul', { class: 'whats-new-list' }, ...r.items.map((item) => el('li', { text: item }))))),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', id: 'whats-new-ok', 'data-icon': 'check', text: t('whatsNew.ok'), onclick: done })));
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('#whats-new-ok').focus();
  }

  async function load() {
    if (data) return data;
    const res = await api('/api/whats-new').catch(() => null);
    data = res && res.ok ? res.body : null;
    return data;
  }

  // Shows what is newer than the last seen release; nothing when nothing is new.
  async function check(tries = 0) {
    const d = await load();
    if (!d || !d.latest) return;
    const last = seen();
    if (last && last >= d.latest) return;
    const fresh = last ? d.releases.filter((r) => r.id > last) : d.releases.slice(0, 1);
    if (!fresh.length) { markSeen(d.latest); return; }
    // another pop-up (an invitation, a dialog of the page) is open: after it
    if (gate.busy || document.querySelector('dialog[open]')) {
      if (tries < 120) setTimeout(() => check(tries + 1), 1000);
      return;
    }
    show(fresh);
  }

  // The whole list, from the menu.
  async function open() {
    const d = await load();
    if (d && d.releases.length) show(d.releases, { all: true });
  }

  // ready: the first check decided (the invitations pop-up waits for it, so "Ce e nou" comes first)
  window.WHATS_NEW = { open, check, ready: check() };
})();
