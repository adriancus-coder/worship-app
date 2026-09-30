'use strict';

// The bridge to Sanctuary Voice (stage 8) UI. One shared panel used everywhere — the event page,
// the leader/presenter live page and the operator console — so the state is the same on every
// surface (the server is the single source of truth; every surface reads /api/events/:id/bridge).
// It connects the worship event to an SV event with a connection code, shows the connection state,
// carries the two direction switches (both default off), and a revoke control. It also offers the
// translation projector source "Traducere · <limbă>" per target language, shown only when picked.
// Every event role uses it fully (owner, presenter, leader, operator); a member never sees it.
//
// Server-to-server only: the panel talks to /api/events/:id/bridge/* and never sees the token.

(function () {
  const { el } = window.PAGE;
  const { t } = window.I18N;

  // container: the panel host. sourcesContainer: where the "Traducere · <limbă>" buttons go (live
  // pages only; omitted on the event page, which has no projector). sendCommand(type, payload):
  // sends a live command (projector.source), on live pages only.
  function create(container, { api, eventId, sendCommand, sourcesContainer = null } = {}) {
    let status = null; // last GET /api/events/:id/bridge
    let snap = null; // last live snapshot (for the active translation source)
    let busy = false;

    const msg = el('p', { class: 'bridge-msg', role: 'status', 'aria-live': 'polite' });

    async function call(method, path, body) {
      busy = true;
      render();
      const res = await api(`/api/events/${eventId}/bridge${path}`, body === undefined ? { method } : { method, body });
      busy = false;
      if (res.ok) {
        status = res.body;
        message('');
      } else {
        message(res.body && res.body.error ? res.body.error : t('common.networkError'), 'error');
      }
      render();
      return res;
    }

    function message(text, kind) {
      msg.textContent = text || '';
      msg.classList.toggle('error', kind === 'error');
    }

    async function load() {
      const res = await api(`/api/events/${eventId}/bridge`);
      if (res.ok) status = res.body;
      render();
    }

    // --- the connection form / state ---

    function connectForm() {
      const code = el('input', { type: 'text', id: 'bridge-code', class: 'bridge-code', maxlength: '8', autocomplete: 'off',
        autocapitalize: 'characters', spellcheck: 'false', 'aria-label': t('bridge.codeLabel'), placeholder: t('bridge.codePlaceholder') });
      const url = el('input', { type: 'url', id: 'bridge-url', class: 'bridge-url', autocomplete: 'off', 'aria-label': t('bridge.svUrlLabel'), placeholder: 'https://sanctuaryvoice.com' });
      const advanced = el('details', { class: 'bridge-advanced' }, el('summary', { text: t('bridge.advanced') }), el('label', { class: 'bridge-field' }, t('bridge.svUrlLabel'), url));
      const submit = el('button', { type: 'submit', 'data-icon': 'link', text: busy ? t('bridge.connecting') : t('bridge.connectButton'), disabled: busy });
      const form = el('form', { class: 'bridge-connect', onsubmit: (e) => {
        e.preventDefault();
        const value = code.value.trim();
        if (!value) return;
        call('POST', '/connect', { code: value, svBaseUrl: url.value.trim() || undefined });
      } }, el('label', { class: 'bridge-field' }, t('bridge.codeLabel'), code), advanced, el('div', { class: 'form-actions' }, submit));
      return form;
    }

    // A direction toggle (aria-pressed), styled as a standalone switch (UI rules).
    function toggle(id, on, label, hint, onToggle) {
      const button = el('button', { type: 'button', id, class: 'bridge-toggle', 'aria-pressed': String(Boolean(on)), disabled: busy, onclick: onToggle }, label);
      return el('div', { class: 'bridge-switch' }, button, hint ? el('span', { class: 'bridge-hint', text: hint }) : null);
    }

    function connectedState() {
      const conn = status.connection;
      const langs = (conn.targetLanguages || []).join(', ');
      const dot = el('span', { class: `bridge-dot ${conn.live ? 'is-live' : 'is-off'}`, 'aria-hidden': 'true' });
      const head = el('p', { class: 'bridge-state' }, dot,
        el('span', { text: conn.live ? t('bridge.connected') : t('bridge.offline') }),
        langs ? el('span', { class: 'bridge-langs', text: t('bridge.connectedTo', { languages: langs }) }) : null);

      const dirIn = toggle('bridge-dir-in', conn.dirIn, t('bridge.dirIn'), t('bridge.dirInHint'), () => {
        call('POST', '/switches', { dirIn: !conn.dirIn, dirOut: conn.dirOut });
      });
      const dirOut = toggle('bridge-dir-out', conn.dirOut, t('bridge.dirOut'), t('bridge.dirOutHint'), () => {
        call('POST', '/switches', { dirIn: conn.dirIn, dirOut: !conn.dirOut });
      });

      const revoke = el('button', { type: 'button', class: 'secondary', 'data-icon': 'unlink', disabled: busy, text: t('bridge.disconnect'),
        onclick: () => { if (window.confirm(t('bridge.disconnectConfirm'))) call('POST', '/disconnect'); } });

      return el('div', { class: 'bridge-connected' }, head, dirIn, dirOut, el('div', { class: 'form-actions' }, revoke));
    }

    function render() {
      const body = status && status.connected ? connectedState() : connectForm();
      container.replaceChildren(el('h3', { class: 'bridge-heading', text: t('bridge.heading') }), body, msg);
      renderSources();
    }

    // The translation projector sources: one "Traducere · <limbă>" per target language, only when
    // connected with dir_in on. The operator/leader picks one explicitly (like every source).
    function renderSources() {
      if (!sourcesContainer) return;
      const conn = status && status.connection;
      const show = Boolean(conn && conn.dirIn && (conn.targetLanguages || []).length);
      sourcesContainer.hidden = !show;
      if (!show) { sourcesContainer.replaceChildren(); return; }
      const active = snap && snap.projector && snap.projector.source === 'translation' ? snap.projector.translationLang : null;
      const live = Boolean(snap && snap.status === 'live');
      sourcesContainer.replaceChildren(...conn.targetLanguages.map((lang) => el('button', {
        type: 'button', class: 'secondary', 'data-translation-lang': lang,
        'aria-pressed': String(active === lang), disabled: !live,
        text: t('bridge.translationSource', { lang: lang.toUpperCase() }),
        onclick: () => sendCommand && sendCommand('projector.source', active === lang ? { source: 'content' } : { source: 'translation', lang }),
      })));
    }

    // Called by the page on every snapshot: refreshes which translation source is active.
    function update(nextSnap) {
      snap = nextSnap;
      renderSources();
    }

    return { load, update, render };
  }

  window.BRIDGE_PANEL = { create };
})();
