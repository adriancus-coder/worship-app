'use strict';

// The team (/team, owner only): the admin's accounts. Adding a person creates the account
// with a temporary password that is shown once, in a card with "Copiază" and a welcome
// message ready to send; the person picks their own password at the first login.
// Per person: rename / change role, reset the password (a new card), deactivate / reactivate.
// The owner's row has no actions.

(function () {
  const { api, el, setTitle, formatDate } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const state = { users: [], baseUrl: null, meId: null, editing: null, confirm: null, result: null };

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
            el('span', { class: `pill role-pill role-${user.role}`, text: owner ? t('team.roles.owner') : t(`team.roles.${user.role}`) }),
            owner ? null : el('span', { class: `pill status-pill status-${status}`, text: t(`team.status.${status}`) }),
            el('span', { class: 'muted', text: lastLogin(user.lastLoginAt) }))),
        owner ? null : el('div', { class: 'team-actions' },
          el('button', { type: 'button', class: 'secondary', 'data-icon': 'edit', text: t('team.edit'), 'aria-label': t('team.editFor', { name: user.name }), onclick: () => openEdit(user) }),
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
    state.baseUrl = res.body.baseUrl;
    $('status').hidden = true;
    render();
  }

  function replaceUser(user) {
    state.users = state.users.map((u) => (u.id === user.id ? user : u));
    render();
  }

  // --- dialogs ----------------------------------------------------------------------

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  $('add-person').addEventListener('click', () => {
    $('add-form').reset();
    say('add-message', '', 'error');
    $('add-dialog').showModal();
    $('add-name').focus();
  });

  $('add-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const role = new FormData($('add-form')).get('add-role');
    $('add-submit').disabled = true;
    try {
      const res = await api('/api/team', { method: 'POST', body: { name: $('add-name').value, email: $('add-email').value, role } });
      if (!res.ok) return say('add-message', res.body.error || t('common.networkError'), 'error');
      await load();
      $('add-dialog').close();
      showResult('created', res.body.user, res.body.temporaryPassword);
    } catch (err) {
      say('add-message', t('common.networkError'), 'error');
    } finally {
      $('add-submit').disabled = false;
    }
  });

  function renderRoleHelp() {
    $('edit-role-help').textContent = t(`team.roleHelp.${$('edit-role').value}`);
  }
  $('edit-role').addEventListener('change', renderRoleHelp);

  function openEdit(user) {
    state.editing = user;
    $('edit-name').value = user.name;
    $('edit-role').value = user.role;
    renderRoleHelp();
    say('edit-message', '', 'error');
    $('edit-dialog').showModal();
    $('edit-name').focus();
  }

  $('edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = state.editing;
    const res = await api(`/api/team/${user.id}`, { method: 'PATCH', body: { name: $('edit-name').value, role: $('edit-role').value } });
    if (!res.ok) return say('edit-message', res.body.error || t('common.networkError'), 'error');
    replaceUser(res.body.user);
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

  document.addEventListener('i18n:change', () => {
    render();
    renderRoleHelp();
    if (state.result) renderResult();
  });

  (async () => {
    const me = await window.SHELL.me;
    state.meId = me && me.user.id;
    await load();
  })().catch(() => {
    $('status').textContent = t('common.networkError');
  });
})();
