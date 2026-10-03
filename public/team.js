'use strict';

// Echipa (/team): the owner's accounts (Persoane), positions (Poziții) and everyone's
// unavailability (Indisponibilități, read-only + own ranges); every other role gets a
// read-only directory (name, role, positions, own unavailability; no emails / phones).
// The owner's part: the admin's accounts. Adding a person creates the account
// with a temporary password that is shown once, in a card with "Copiază" and a welcome
// message ready to send; the person picks their own password at the first login.
// Per person: rename / change role, reset the password (a new card), deactivate / reactivate.
// The owner's row has no actions.

(function () {
  const { api, el, setTitle, formatDate } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const state = { users: [], positions: [], roles: [], baseUrl: null, emailEnabled: false, meId: null, editing: null, confirm: null, result: null };
  const positionName = (id) => { const p = state.positions.find((x) => x.id === id); return p ? window.PAGE.positionLabel(p) : null; };

  const baseUrl = () => state.baseUrl || window.location.origin;

  function say(id, text, kind) {
    $(id).className = `message${kind ? ` ${kind}` : ''}`;
    $(id).textContent = text || '';
  }

  // "Azi, 18:40" / a date for the last login.
  function lastLogin(ms) {
    if (!ms) return t('team.neverLoggedIn');
    const d = new Date(ms);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return t('team.lastLogin', { when: `${formatDate(day, String(new Date().getFullYear()))}, ${time}` });
  }

  function statusOf(user) {
    if (!user.active) return 'inactive';
    return user.mustChangePassword ? 'mustChange' : 'active';
  }

  // --- list -------------------------------------------------------------------------

  function render() {
    setTitle('team.pageTitle');
    $('team').replaceChildren(...state.users.map((user) => {
      const owner = user.role === 'owner';
      const status = statusOf(user);
      return el('li', { class: `team-row${user.active ? '' : ' inactive'}` },
        el('div', { class: 'team-main' },
          el('p', { class: 'team-name' }, el('span', { text: user.name }),
            user.id === state.meId ? el('span', { class: 'muted', text: ` · ${t('team.you')}` }) : null),
          el('p', { class: 'team-email', text: user.email }),
          el('p', { class: 'team-meta' },
            el('span', { class: `pill role-pill role-${user.role}`, text: owner ? window.PAGE.roleLabel('owner') : personRole(user) }),
            owner ? null : el('span', { class: `pill status-pill status-${status}`, text: t(`team.status.${status}`) }),
            el('span', { class: 'muted', text: lastLogin(user.lastLoginAt) })),
          // "Indisponibil" (lib/unavailability.js): the person's upcoming ranges, for the owner.
          (user.unavailability || []).length ? el('p', { class: 'team-unavail' }, ...user.unavailability.map((r) => el('span', { class: 'pill unavail-pill', text: t('team.unavailable', { when: r.dateFrom === r.dateTo ? formatDate(r.dateFrom, String(new Date().getFullYear())) : t('unavail.range', { from: formatDate(r.dateFrom, String(new Date().getFullYear())), to: formatDate(r.dateTo, String(new Date().getFullYear())) }) }) }))) : null,
          // The person's usual positions (lib/positions.js), the pickers' default suggestions.
          el('p', { class: 'team-positions' }, ...((user.positionIds || []).map(positionName).filter(Boolean).length
            ? user.positionIds.map(positionName).filter(Boolean).map((name) => el('span', { class: 'pill position-pill', text: name }))
            : [el('span', { class: 'muted', text: t('team.noPositions') })]))),
        owner ? null : el('div', { class: 'team-actions' },
          el('button', { type: 'button', class: 'secondary', 'data-icon': 'edit', text: t('team.edit'), 'aria-label': t('team.editFor', { name: user.name }), onclick: () => openEdit(user) }),
          // By email (only while the server can send): the invitation again while the person
          // has never signed in, a reset link any time. The temporary-password card stays.
          state.emailEnabled && user.active && !user.lastLoginAt
            ? el('button', { type: 'button', class: 'secondary', 'data-icon': 'mail', text: t('team.resendInvite'), 'aria-label': t('team.resendInviteFor', { name: user.name }), onclick: () => sendLink('invite', user) }) : null,
          state.emailEnabled && user.active
            ? el('button', { type: 'button', class: 'secondary', 'data-icon': 'mail', text: t('team.sendReset'), 'aria-label': t('team.sendResetFor', { name: user.name }), onclick: () => sendLink('reset-link', user) }) : null,
          el('button', { type: 'button', class: 'secondary', 'data-icon': 'key', text: t('team.reset'), 'aria-label': t('team.resetFor', { name: user.name }), onclick: () => openConfirm('reset', user) }),
          user.active
            ? el('button', { type: 'button', class: 'secondary danger-text', 'data-icon': 'close', text: t('team.deactivate'), 'aria-label': t('team.deactivateFor', { name: user.name }), onclick: () => openConfirm('deactivate', user) })
            : el('button', { type: 'button', class: 'secondary', 'data-icon': 'restart', text: t('team.reactivate'), 'aria-label': t('team.reactivateFor', { name: user.name }), onclick: () => openConfirm('reactivate', user) })));
    }));
  }

  async function load() {
    const res = await api('/api/team');
    if (!res.ok) {
      $('status').removeAttribute('data-i18n');
      $('status').textContent = res.body.error || t('common.networkError');
      return;
    }
    state.users = res.body.users;
    state.positions = res.body.positions || [];
    state.roles = res.body.roles || [];
    renderRoleOptions();
    state.baseUrl = res.body.baseUrl;
    state.emailEnabled = Boolean(res.body.emailEnabled);
    $('status').hidden = true;
    render();
  }

  // POST /api/team/:id/invite | reset-link -> a page message with the address.
  async function sendLink(path, user, messageId = 'page-message') {
    say(messageId, '', 'success');
    try {
      const res = await api(`/api/team/${user.id}/${path}`, { method: 'POST' });
      if (!res.ok) return say(messageId, res.body.error || t('common.networkError'), 'error');
      replaceUser(res.body.user);
      say(messageId, t(path === 'invite' ? 'team.invited' : 'team.resetLinkSent', { email: res.body.sentTo }), 'success');
      return true;
    } catch (err) {
      say(messageId, t('common.networkError'), 'error');
    }
    return false;
  }

  function replaceUser(user) {
    state.users = state.users.map((u) => (u.id === user.id ? user : u));
    render();
  }

  // --- dialogs ----------------------------------------------------------------------

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  // With email: "Trimite invitația pe email" is the primary action and the temporary-password
  // card the secondary one; without: the card alone.
  $('add-person').addEventListener('click', () => {
    $('add-form').reset();
    say('add-message', '', 'error');
    $('add-submit-email').hidden = !state.emailEnabled;
    $('add-email-hint').hidden = !state.emailEnabled;
    $('add-submit').className = state.emailEnabled ? 'secondary' : '';
    $('add-dialog').showModal();
    $('add-name').focus();
  });

  $('add-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const byEmail = state.emailEnabled && event.submitter && event.submitter.id === 'add-submit-email';
    const role = new FormData($('add-form')).get('add-role');
    $('add-submit').disabled = true;
    $('add-submit-email').disabled = true;
    try {
      const res = await api('/api/team', { method: 'POST', body: { name: $('add-name').value, email: $('add-email').value, role } });
      if (!res.ok) return say('add-message', res.body.error || t('common.networkError'), 'error');
      await load();
      if (rolesEditor) rolesEditor.reload();
      $('add-dialog').close();
      if (byEmail && await sendLink('invite', res.body.user)) return;
      // No email (or it failed: the page message says so): the card with the temporary password.
      showResult('created', res.body.user, res.body.temporaryPassword);
    } catch (err) {
      say('add-message', t('common.networkError'), 'error');
    } finally {
      $('add-submit').disabled = false;
      $('add-submit-email').disabled = false;
    }
  });

  function renderRoleHelp() {
    $('edit-role-help').textContent = roleHelpOf($('edit-role').value);
  }
  $('edit-role').addEventListener('change', renderRoleHelp);

  function openEdit(user) {
    state.editing = user;
    $('edit-name').value = user.name;
    $('edit-role').value = roleValue(user);
    renderRoleHelp();
    $('edit-positions').replaceChildren(...state.positions.filter((p) => p.active || (user.positionIds || []).includes(p.id)).map((p) => el('label', { class: 'checkbox' },
      el('input', { type: 'checkbox', name: 'edit-position', value: String(p.id), checked: (user.positionIds || []).includes(p.id) ? 'checked' : null }),
      el('span', { text: window.PAGE.positionLabel(p) }))));
    say('edit-message', '', 'error');
    $('edit-dialog').showModal();
    $('edit-name').focus();
  }

  $('edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = state.editing;
    const res = await api(`/api/team/${user.id}`, { method: 'PATCH', body: { name: $('edit-name').value, role: $('edit-role').value } });
    if (!res.ok) return say('edit-message', res.body.error || t('common.networkError'), 'error');
    const positionIds = [...document.querySelectorAll('#edit-positions input:checked')].map((box) => Number(box.value));
    const pos = await api(`/api/team/${user.id}/positions`, { method: 'PUT', body: { positionIds } });
    if (!pos.ok) return say('edit-message', pos.body.error || t('common.networkError'), 'error');
    replaceUser(pos.body.user);
    if (rolesEditor) rolesEditor.reload();
    $('edit-dialog').close();
    say('page-message', t('team.saved', { name: res.body.user.name }), 'success');
  });

  function openConfirm(action, user) {
    state.confirm = { action, user };
    $('confirm-heading').textContent = t(`team.confirm.${action}Heading`, { name: user.name });
    $('confirm-text').textContent = t(`team.confirm.${action}Text`, { name: user.name });
    $('confirm-yes').textContent = t(`team.confirm.${action}Yes`);
    $('confirm-yes').className = action === 'deactivate' ? 'danger' : '';
    say('confirm-message', '', 'error');
    $('confirm-dialog').showModal();
  }

  $('confirm-yes').addEventListener('click', async () => {
    const { action, user } = state.confirm;
    const path = action === 'reset' ? 'reset-password' : action;
    $('confirm-yes').disabled = true;
    try {
      const res = await api(`/api/team/${user.id}/${path}`, { method: 'POST' });
      if (!res.ok) return say('confirm-message', res.body.error || t('common.networkError'), 'error');
      replaceUser(res.body.user);
      $('confirm-dialog').close();
      if (action === 'reset') showResult('reset', res.body.user, res.body.temporaryPassword);
      else say('page-message', t(`team.${action}d`, { name: user.name }), 'success');
    } finally {
      $('confirm-yes').disabled = false;
    }
  });

  // --- the result card (shown once) -------------------------------------------------

  function welcomeMessage() {
    const { user, password } = state.result;
    return t('team.welcome', { appName: document.documentElement.dataset.appName || '', url: baseUrl(), email: user.email, password });
  }

  function renderResult() {
    const { kind, user, password } = state.result;
    $('result-heading').textContent = t(kind === 'created' ? 'team.createdHeading' : 'team.resetHeading', { name: user.name });
    $('result-email').textContent = user.email;
    $('result-password').textContent = password;
    $('result-message').value = welcomeMessage();
  }

  function showResult(kind, user, password) {
    state.result = { kind, user, password };
    renderResult();
    say('copy-status', '', 'success');
    $('share-message').hidden = typeof navigator.share !== 'function';
    $('result-dialog').showModal();
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // No clipboard API (http, older browsers): select and copy.
      const area = $('result-message');
      const before = area.value;
      area.value = text;
      area.select();
      const ok = document.execCommand && document.execCommand('copy');
      area.value = before;
      return Boolean(ok);
    }
  }

  $('copy-password').addEventListener('click', async () => {
    say('copy-status', (await copy(state.result.password)) ? t('team.copiedPassword') : t('team.copyFailed'), 'success');
  });
  $('copy-message').addEventListener('click', async () => {
    say('copy-status', (await copy(welcomeMessage())) ? t('team.copiedMessage') : t('team.copyFailed'), 'success');
  });
  $('share-message').addEventListener('click', () => {
    navigator.share({ text: welcomeMessage() }).catch(() => {});
  });
  // The password is gone once the card closes.
  $('result-dialog').addEventListener('close', () => {
    state.result = null;
    $('result-password').textContent = '';
    $('result-message').value = '';
  });

  // A person's role as shown: a role the owner created (its emoji and name) or a built-in one.
  const customOf = (user) => (user.customRoleId ? state.roles.find((r) => r.id === user.customRoleId) : null);
  const personRole = (user) => { const c = customOf(user); return c ? (c.emoji ? `${c.emoji} ${c.name}` : c.name) : window.PAGE.roleLabel(user.role); };
  const roleValue = (user) => (user.customRoleId ? `custom:${user.customRoleId}` : user.role);

  // The role choices: the built-in ones (the emoji before each name, PAGE.roleLabel) and the
  // roles the owner created (Echipa → Roluri) after them.
  const BUILT_IN = ['presenter', 'leader', 'operator', 'member'];
  let rolesEditor = null; // Echipa → Roluri (the owner): its counts follow the people's roles
  function renderRoleOptions() {
    const select = $('edit-role');
    const current = select.value;
    select.replaceChildren(...BUILT_IN.map((role) => el('option', { value: role, text: window.PAGE.roleLabel(role) })),
      ...state.roles.map((r) => el('option', { value: `custom:${r.id}`, text: r.emoji ? `${r.emoji} ${r.name}` : r.name })));
    if (current) select.value = current;
    const checked = new FormData($('add-form')).get('add-role');
    $('add-custom-roles').replaceChildren(...state.roles.map((r) => el('label', { class: 'role-option' },
      el('input', { type: 'radio', name: 'add-role', value: `custom:${r.id}`, checked: checked === `custom:${r.id}` ? 'checked' : null }),
      el('span', null,
        el('strong', null, el('span', { class: 'role-emoji', 'aria-hidden': 'true', text: r.emoji || '' }), r.emoji ? ' ' : '', el('span', { text: r.name })),
        el('span', { class: 'hint', text: roleHelpOf(`custom:${r.id}`) })))));
  }
  function roleHelpOf(value) {
    const match = /^custom:(\d+)$/.exec(value);
    if (!match) return t(`team.roleHelp.${value}`);
    const r = state.roles.find((x) => x.id === Number(match[1]));
    if (!r) return '';
    const perms = r.perms.length ? r.perms.map((p) => t(`customRoles.permsShort.${p}`)).join(', ') : t('customRoles.noRights');
    return `${t(`customRoles.bases.${r.base}`)}. ${t('customRoles.help', { perms })}`;
  }
  renderRoleOptions();

  document.addEventListener('i18n:change', () => {
    render();
    renderRoleOptions();
    renderRoleHelp();
    if (state.result) renderResult();
  });

  // --- the owner's tabs: Persoane · Poziții · Indisponibilități ------------------------------

  const TABS = ['people', 'positions', 'roles', 'unavail'];
  const tabButtons = [...document.querySelectorAll('#team-tabs [role="tab"]')];
  function showTab(name) {
    for (const tab of TABS) $(`${tab}-panel`).hidden = tab !== name;
    const url = new URL(window.location.href);
    if (name === 'people') url.searchParams.delete('tab'); else url.searchParams.set('tab', name);
    window.history.replaceState(null, '', url);
    if (name === 'unavail') renderUnavailAll();
  }
  window.PAGE.setupTabs(tabButtons, (index) => showTab(tabButtons[index].dataset.tab));

  // Everyone's upcoming ranges (the owner's Indisponibilități tab), read-only.
  function renderUnavailAll() {
    const year = String(new Date().getFullYear());
    const rows = state.users.filter((u) => (u.unavailability || []).length);
    $('unavail-all-empty').hidden = rows.length > 0;
    $('unavail-all').replaceChildren(...rows.map((u) => el('li', { class: 'unavail-all-row' },
      el('span', { class: 'unavail-all-name', text: u.name }),
      ...u.unavailability.map((r) => el('span', { class: 'pill unavail-pill', text: `${r.dateFrom === r.dateTo ? formatDate(r.dateFrom, year) : t('unavail.range', { from: formatDate(r.dateFrom, year), to: formatDate(r.dateTo, year) })}${r.note ? ` · ${r.note}` : ''}` })))));
  }

  // --- every other role: the read-only directory ------------------------------------------

  async function loadDirectory() {
    const res = await api('/api/team/directory');
    if (!res.ok) {
      $('status').removeAttribute('data-i18n');
      $('status').textContent = res.body.error || t('common.networkError');
      return;
    }
    state.users = res.body.users;
    state.positions = res.body.positions || [];
    state.roles = res.body.roles || [];
    $('status').hidden = true;
    renderDirectory();
  }

  function renderDirectory() {
    const year = String(new Date().getFullYear());
    $('directory').replaceChildren(...state.users.map((user) => el('li', { class: 'team-row directory-row' },
      el('div', { class: 'team-main' },
        el('p', { class: 'team-name' }, el('span', { text: user.name }), user.me ? el('span', { class: 'muted', text: ` · ${t('team.you')}` }) : null),
        el('p', { class: 'team-meta' }, el('span', { class: `pill role-pill role-${user.role}`, text: personRole(user) })),
        el('p', { class: 'team-positions' }, ...((user.positionIds || []).map(positionName).filter(Boolean).length
          ? user.positionIds.map(positionName).filter(Boolean).map((name) => el('span', { class: 'pill position-pill', text: name }))
          : [el('span', { class: 'muted', text: t('team.noPositions') })])),
        (user.unavailability || []).length ? el('p', { class: 'team-unavail' }, ...user.unavailability.map((r) => el('span', { class: 'pill unavail-pill', text: t('team.unavailable', { when: r.dateFrom === r.dateTo ? formatDate(r.dateFrom, year) : t('unavail.range', { from: formatDate(r.dateFrom, year), to: formatDate(r.dateTo, year) }) }) }))) : null))));
  }

  (async () => {
    const me = await window.SHELL.me;
    state.meId = me && me.user.id;
    const owner = Boolean(me && me.user.role === 'owner');
    $('add-person').hidden = !owner;
    $('my-profile').hidden = owner;
    $('team-tabs').hidden = !owner;
    $('directory').hidden = owner;
    $('team').hidden = !owner;
    if (!owner) {
      $('team-intro').dataset.i18n = 'team.directoryIntro';
      $('team-intro').textContent = t('team.directoryIntro');
      document.addEventListener('i18n:change', renderDirectory);
      await loadDirectory();
      return;
    }
    window.POSITIONS_EDITOR.mount($('positions-editor'));
    // a role changed or deleted: the people's roles may have changed too (reload the list)
    rolesEditor = window.ROLES_EDITOR.mount($('roles-editor'), { onChange: (roles) => { state.roles = roles; renderRoleOptions(); load(); } });
    await load();
    const asked = new URLSearchParams(window.location.search).get('tab');
    if (TABS.includes(asked) && asked !== 'people') {
      const index = tabButtons.findIndex((b) => b.dataset.tab === asked);
      tabButtons.forEach((b, i) => { b.setAttribute('aria-selected', String(i === index)); b.tabIndex = i === index ? 0 : -1; });
      showTab(asked);
    }
    document.addEventListener('i18n:change', () => { if (!$('unavail-panel').hidden) renderUnavailAll(); });
  })().catch(() => {
    $('status').textContent = t('common.networkError');
  });
})();
