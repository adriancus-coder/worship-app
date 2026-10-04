'use strict';

// Projector screens (/screens, owner and operator): the screens first (online, last seen,
// rename, test pattern, margin, revoke, each one's static LINK to copy / email / share), then
// "Adaugă un ecran" in three ways: with a name (its link opens on the projector PC, no
// pairing), from the operator console (nothing to do here), or with a code on a PC where the
// link cannot be typed (the projector address, then the 6-digit code and a name).

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const REFRESH_MS = 15000;

  const state = { screens: null, baseUrl: null, safeMargin: 5, renaming: null, revoking: null, addressOpen: new Set() };

  // "Adresa proiectorului" (the code way): PUBLIC_BASE_URL when set, else this page's origin.
  const origin = () => state.baseUrl || window.location.origin;
  const screenAddress = () => `${origin()}/screen`;
  // A screen's static link: opens that screen's output anywhere, until it is revoked.
  const screenLink = (screen) => `${origin()}${screen.link}`;

  async function copyText(text, input) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      if (!input) return false;
      input.select();
      return Boolean(document.execCommand && document.execCommand('copy'));
    }
  }

  function setStatus(text) {
    $('status').removeAttribute('data-i18n');
    $('status').textContent = text;
    $('status').hidden = !text;
  }

  function lastSeen(screen) {
    if (screen.online) return t('screens.onlineNow');
    if (!screen.lastSeenAt) return t('screens.neverSeen');
    const when = new Intl.DateTimeFormat(window.I18N.lang === 'en' ? 'en-GB' : 'ro-RO', { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(screen.lastSeenAt));
    return t('screens.lastSeen', { when });
  }

  function render() {
    if (!state.screens) return;
    setStatus(state.screens.length ? '' : t('screens.empty'));
    $('screens').replaceChildren(...state.screens.map((screen) => el('li', { class: 'screen-row' },
      el('span', { class: `online-dot${screen.online ? ' on' : ''}`, 'aria-hidden': 'true' }),
      el('span', { class: 'screen-text' },
        el('span', { class: 'screen-name', text: screen.name }),
        el('span', { class: 'screen-meta', text: `${screen.online ? t('screens.online') : t('screens.offline')} · ${lastSeen(screen)}` })),
      el('span', { class: 'screen-tools' },
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'edit', text: t('screens.rename'), 'aria-label': t('screens.renameLabel', { name: screen.name }), onclick: () => openRename(screen) }),
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'projector', 'data-pattern': String(screen.id), 'aria-pressed': String(Boolean(screen.testPattern)), text: t(screen.testPattern ? 'screens.patternOff' : 'screens.pattern'), 'aria-label': t(screen.testPattern ? 'screens.patternOffFor' : 'screens.patternFor', { name: screen.name }), disabled: screen.online ? null : 'disabled', onclick: () => togglePattern(screen) }),
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'link', text: t('screens.rowLink'), 'aria-expanded': String(state.addressOpen.has(screen.id)), 'aria-label': t('screens.rowLinkLabel', { name: screen.name }), onclick: () => toggleAddress(screen) }),
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'close', text: t('screens.revoke'), 'aria-label': t('screens.revokeLabel', { name: screen.name }), onclick: () => openRevoke(screen) })),
      // "Ecran de test": the calibration pattern on that screen, with "Aplică n %" under it.
      screen.testPattern ? patternPanel(screen) : null,
      // "Margine de siguranță": this screen's own value or the church default (settings).
      marginControl(screen),
      // "Linkul ecranului": to open on the projector PC (copy / email / share).
      state.addressOpen.has(screen.id) ? linkBox(screen) : null)));
  }

  async function togglePattern(screen) {
    const res = await api(`/api/screens/${screen.id}/test-pattern`, { method: 'POST', body: { on: !screen.testPattern } });
    if (!res.ok) return setStatus(res.body.error || t('common.networkError'));
    state.screens = state.screens.map((s) => (s.id === screen.id ? { ...s, ...res.body.screen } : s));
    render();
  }

  // Under a screen showing the pattern: read the first fully visible percent, apply it.
  function patternPanel(screen) {
    const message = el('span', { class: 'message', role: 'status' });
    const apply = async (percent) => {
      const res = await api(`/api/screens/${screen.id}/margin`, { method: 'PUT', body: { percent } });
      if (!res.ok) {
        message.className = 'message error';
        message.textContent = res.body.error || t('common.networkError');
        return;
      }
      state.screens = state.screens.map((s) => (s.id === screen.id ? { ...s, ...res.body.screen, online: s.online, testPattern: s.testPattern } : s));
      render();
      const row = document.querySelector(`[data-pattern="${screen.id}"]`);
      if (row) row.closest('.screen-row').querySelector('.pattern-panel .message').textContent = t('screens.patternApplied', { n: percent });
    };
    return el('div', { class: 'pattern-panel' },
      el('span', { class: 'hint', text: t('screens.patternHint') }),
      el('div', { class: 'pattern-apply', role: 'group', 'aria-label': t('screens.patternApplyLabel') },
        ...[2, 4, 6, 8, 10].map((n) => el('button', { type: 'button', class: screen.safeMargin === n ? '' : 'secondary', 'data-apply': String(n), text: t('screens.patternApply', { n }), onclick: () => apply(n) }))),
      message);
  }

  function marginControl(screen) {
    const select = el('select', { 'aria-label': t('screens.marginLabelFor', { name: screen.name }), 'data-margin': String(screen.id) },
      el('option', { value: '', text: t('screens.marginDefault', { n: state.safeMargin }) }),
      ...Array.from({ length: 13 }, (_, n) => el('option', { value: String(n), text: t('screens.marginPercent', { n }) })));
    select.value = screen.safeMargin === null || screen.safeMargin === undefined ? '' : String(screen.safeMargin);
    const message = el('span', { class: 'message', role: 'status' });
    select.addEventListener('change', async () => {
      const percent = select.value === '' ? null : Number(select.value);
      const res = await api(`/api/screens/${screen.id}/margin`, { method: 'PUT', body: { percent } });
      if (!res.ok) {
        message.className = 'message error';
        message.textContent = res.body.error || t('common.networkError');
        return;
      }
      state.screens = state.screens.map((s) => (s.id === screen.id ? { ...s, ...res.body.screen, online: s.online } : s));
      message.className = 'message success';
      message.textContent = t('screens.marginSaved', { name: screen.name, value: percent === null ? t('screens.marginDefault', { n: state.safeMargin }) : t('screens.marginPercent', { n: percent }) });
    });
    return el('label', { class: 'screen-margin' }, el('span', { class: 'hint', text: t('screens.marginLabel') }), select, message);
  }

  function linkBox(screen) {
    const url = screenLink(screen);
    const input = el('input', { type: 'text', class: 'mono', readonly: 'readonly', value: url, 'aria-label': t('screens.rowLinkLabel', { name: screen.name }) });
    const message = el('span', { class: 'message', role: 'status' });
    const appName = document.documentElement.dataset.appName || '';
    const body = t('screens.linkEmailBody', { name: screen.name, url });
    return el('div', { class: 'screen-address' },
      el('span', { class: 'hint', text: t('screens.rowLinkHint') }),
      el('div', { class: 'address-box' }, input,
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'copy', text: t('screens.copy'), 'aria-label': t('screens.copyLabel', { name: screen.name }),
          onclick: async () => { message.textContent = (await copyText(url, input)) ? t('screens.copied') : t('screens.copyFailed'); } })),
      el('div', { class: 'form-actions address-actions' },
        el('a', { class: 'button secondary', 'data-icon': 'mail', text: t('screens.email'), href: `mailto:?subject=${encodeURIComponent(t('screens.linkEmailSubject', { appName, name: screen.name }))}&body=${encodeURIComponent(body)}` }),
        typeof navigator.share === 'function'
          ? el('button', { type: 'button', class: 'secondary', 'data-icon': 'share', text: t('screens.share'), onclick: () => navigator.share({ title: screen.name, text: body }).catch(() => {}) })
          : null),
      message);
  }

  function toggleAddress(screen) {
    if (state.addressOpen.has(screen.id)) state.addressOpen.delete(screen.id);
    else state.addressOpen.add(screen.id);
    render();
  }

  async function load() {
    const res = await api('/api/screens');
    if (!res.ok) {
      setStatus(res.body.error || t('common.networkError'));
      return;
    }
    state.screens = res.body.screens;
    state.baseUrl = res.body.baseUrl || null;
    if (Number.isInteger(res.body.safeMargin)) state.safeMargin = res.body.safeMargin;
    render();
    renderAddress();
  }

  // --- "Adaugă un ecran" with a code: the address to hand over, then the code ---------------

  function renderAddress() {
    const url = screenAddress();
    $('screen-address').value = url;
    const appName = document.documentElement.dataset.appName || '';
    const subject = t('screens.emailSubject', { appName });
    const body = t('screens.emailBody', { url });
    $('address-email').href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    $('address-share').hidden = typeof navigator.share !== 'function';
  }

  $('pair-open').addEventListener('click', () => {
    const open = $('code-way').hidden;
    $('code-way').hidden = !open;
    $('pair-open').setAttribute('aria-expanded', String(open));
    if (open) $('screen-address').focus();
  });
  $('address-copy').addEventListener('click', async () => {
    const ok = await copyText(screenAddress(), $('screen-address'));
    $('address-message').className = `message ${ok ? 'success' : 'error'}`;
    $('address-message').textContent = ok ? t('screens.copied') : t('screens.copyFailed');
  });
  $('address-share').addEventListener('click', () => {
    navigator.share({ title: t('screens.addressLabel'), text: t('screens.emailBody', { url: screenAddress() }) }).catch(() => {});
  });

  // --- "Adaugă un ecran" with a name: the screen and its link ------------------------------

  $('create-name').value = t('screens.defaultName');
  $('create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('create-message');
    message.className = 'message';
    message.textContent = '';
    $('create-submit').disabled = true;
    try {
      const res = await api('/api/screens', { method: 'POST', body: { name: $('create-name').value } });
      if (res.status === 201) {
        message.className = 'message success';
        message.textContent = t('screens.created', { name: res.body.screen.name });
        state.addressOpen.add(res.body.screen.id); // the new row opens on its link
        await load();
        const row = document.querySelector(`.screen-address input[value="${screenLink(res.body.screen)}"]`);
        if (row) row.focus();
      } else {
        message.className = 'message error';
        message.textContent = res.body.error || t('common.networkError');
      }
    } catch (err) {
      message.className = 'message error';
      message.textContent = t('common.networkError');
    } finally {
      $('create-submit').disabled = false;
    }
  });

  // --- pairing with a code -----------------------------------------------------------

  $('pair-name').value = t('screens.defaultName');
  $('pair-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('pair-message');
    message.className = 'message';
    message.textContent = '';
    $('pair-submit').disabled = true;
    try {
      const res = await api('/api/screens/claim', { method: 'POST', body: { code: $('pair-code').value, name: $('pair-name').value } });
      if (res.status === 201) {
        message.className = 'message success';
        message.textContent = t('screens.paired', { name: res.body.screen.name });
        $('pair-code').value = '';
        // The screen collects its token on its next poll (every 3 s); it is listed then.
        [1500, 4000, 8000].forEach((ms) => setTimeout(() => load().catch(() => {}), ms));
      } else {
        message.className = 'message error';
        message.textContent = res.body.error || t('common.networkError');
      }
    } catch (err) {
      message.className = 'message error';
      message.textContent = t('common.networkError');
    } finally {
      $('pair-submit').disabled = false;
    }
  });

  // --- rename / revoke ---------------------------------------------------------------

  function openRename(screen) {
    state.renaming = screen;
    $('rename-name').value = screen.name;
    $('rename-message').textContent = '';
    $('rename-dialog').showModal();
    $('rename-name').focus();
  }

  $('rename-cancel').addEventListener('click', () => $('rename-dialog').close());
  $('rename-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const res = await api(`/api/screens/${state.renaming.id}`, { method: 'PUT', body: { name: $('rename-name').value } });
    if (!res.ok) {
      $('rename-message').textContent = res.body.error || t('common.networkError');
      return;
    }
    $('rename-dialog').close();
    await load();
  });

  function openRevoke(screen) {
    state.revoking = screen;
    $('revoke-text').textContent = t('screens.revokeText', { name: screen.name });
    $('revoke-dialog').returnValue = '';
    $('revoke-dialog').showModal();
  }

  $('revoke-dialog').addEventListener('close', async () => {
    if ($('revoke-dialog').returnValue !== 'revoke' || !state.revoking) return;
    const res = await api(`/api/screens/${state.revoking.id}`, { method: 'DELETE' });
    if (!res.ok) setStatus(res.body.error || t('common.networkError'));
    await load();
  });

  document.addEventListener('i18n:change', () => {
    setTitle('screens.pageTitle');
    render();
    renderAddress();
  });

  setTitle('screens.pageTitle');

  load().catch(() => setStatus(t('common.networkError')));
  setInterval(() => {
    if (!document.hidden) load().catch(() => {});
  }, REFRESH_MS);
})();
