'use strict';

// One church on the platform (/platform/:id, the platform owner only): a header card (name,
// status, created, last activity) with the church-level actions, then three tabs -
// Prezentare (usage counts, the storage bar, a settings summary, the last backup),
// Echipa (its accounts, the same interactions as /team, with the welcome-message card) and
// Ecrane (its paired screens, revoke). Counts and health only: the platform owner never
// reads a church's songs, events or media. The platform's own church is managed on /team.

(function () {
  const { api, el, setTitle, formatDate, setupTabs } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const churchId = Number(window.location.pathname.split('/')[2]);
  const BACKUP_OLD_MS = 30 * 24 * 60 * 60 * 1000;
  const MB = 1024 * 1024;
  const state = { admin: null, defaultQuota: 0, baseUrl: null, users: null, emailEnabled: false, screens: null, editing: null, confirm: null, result: null, tab: 'overview' };

  const baseUrl = () => state.baseUrl || window.location.origin;
  const path = (suffix = '') => `/api/platform/admins/${churchId}${suffix}`;

  function size(bytes) {
    if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
    return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  }

  function say(id, text, kind) {
    $(id).className = `message${kind ? ` ${kind}` : ''}`;
    $(id).textContent = text || '';
  }

  const dayOf = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dateText = (ms) => formatDate(dayOf(ms), String(new Date().getFullYear()));
  const stamp = (ms) => new Intl.DateTimeFormat(window.I18N.lang === 'en' ? 'en-GB' : 'ro-RO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));

  // --- header ------------------------------------------------------------------------

  function renderHead() {
    const a = state.admin;
    setTitle('platformChurch.pageTitle', { name: a.name });
    $('church-name').textContent = a.name;
    $('church-status').className = `pill status-pill status-${a.active ? 'active' : 'inactive'}`;
    $('church-status').textContent = t(a.active ? 'platform.active' : 'platform.inactive');
    $('church-platform').hidden = !a.platform;
    $('church-meta').textContent = [
      t('platformChurch.created', { when: dateText(a.createdAt) }),
      a.lastActivityAt ? t('platform.lastActivity', { when: dateText(a.lastActivityAt) }) : t('platform.noActivity'),
      a.ownerEmail || '',
    ].filter(Boolean).join(' · ');
    $('act-deactivate').hidden = a.platform || !a.active;
    $('act-reactivate').hidden = a.platform || a.active;
    // Permanent deletion: only a deactivated church; pending -> the pill and "Anulează".
    const pending = Boolean(a.deleteAt);
    $('church-delete').hidden = !pending;
    $('church-delete').textContent = pending ? t('platform.deletePending', { date: dateText(a.deleteAt) }) : '';
    $('act-cancel-delete').hidden = !pending;
    $('delete-area').hidden = a.platform || a.active || pending;
    $('delete-hint').hidden = a.platform || !a.active;
  }

  // --- Prezentare -----------------------------------------------------------------------

  function usageCard(label, value, detail) {
    return el('div', { class: 'usage-card' },
      el('p', { class: 'usage-value', text: String(value) }),
      el('p', { class: 'usage-label', text: label }),
      detail ? el('p', { class: 'usage-detail', text: detail }) : null);
  }

  function renderOverview() {
    const a = state.admin;
    const u = a.usage;
    const roles = ['owner', 'leader', 'operator', 'member'].map((r) => `${u.usersByRole[r]} ${t(`team.roles.${r}`).toLowerCase()}`).join(' · ');
    const events = ['planned', 'live', 'finished'].map((st) => `${u.eventsByStatus[st]} ${t(`events.status.${st}`).toLowerCase()}`).join(' · ');
    $('usage').replaceChildren(
      usageCard(t('platformChurch.usersLabel'), a.users, `${roles} · ${t('platformChurch.usersActive', { n: u.usersActive })}`),
      usageCard(t('platformChurch.songsLabel'), u.songs),
      usageCard(t('platformChurch.eventsLabel'), a.events, `${events} · ${t('platformChurch.templates', { n: u.templates })}`),
      usageCard(t('platformChurch.mediaLabel'), u.mediaFiles, `${size(u.mediaBytes)} · ${t('platformChurch.mediaLinks', { n: u.mediaLinks })}`),
      usageCard(t('platformChurch.screensLabel'), u.screens, t('platformChurch.screensOnline', { n: u.screensOnline })));
    const pct = a.mediaMaxBytes ? Math.min(100, (a.storageBytes / a.mediaMaxBytes) * 100) : 0;
    $('storage-text').textContent = `${t('platform.storage', { used: size(a.storageBytes), max: size(a.mediaMaxBytes) })}${a.mediaMaxOverride ? ` · ${t('platform.quotaCustom')}` : ''}`;
    $('storage-fill').style.width = `${pct.toFixed(1)}%`;
    $('storage-bar').classList.toggle('high', pct > 85);
    const s = a.settings;
    const weekday = new Intl.DateTimeFormat(window.I18N.lang, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + s.service.weekday)));
    const rows = [
      [t('platformChurch.timezone'), s.timezone],
      [t('settings.serviceHeading'), `${weekday}, ${s.service.time}`],
      [t('settings.themeHeading'), t(`theme.${s.themeDefault}`)],
      [t('settings.notationHeading'), t(s.chordNotationDefault === 'solfege' ? 'settings.notationSolfege' : 'settings.notationLetters')],
    ];
    $('settings').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
    const last = a.backup && a.backup.lastAt;
    $('backup-text').textContent = last ? t('platformChurch.backupLast', { when: stamp(last), size: size(a.backup.lastBytes || 0) }) : t('platformChurch.backupNever');
    $('backup-warning').hidden = Boolean(last) && Date.now() - last < BACKUP_OLD_MS;
    $('backup-card').classList.toggle('warn', !$('backup-warning').hidden);
  }

  // --- Echipa ------------------------------------------------------------------------------

  function lastLogin(ms) {
    if (!ms) return t('team.neverLoggedIn');
    const d = new Date(ms);
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return t('team.lastLogin', { when: `${dateText(ms)}, ${time}` });
  }

  const statusOf = (user) => (!user.active ? 'inactive' : (user.mustChangePassword ? 'mustChange' : 'active'));

  function renderTeam() {
    const own = state.admin.platform;
    $('team-own').hidden = !own;
    $('add-person').hidden = own;
    $('team-intro').hidden = own;
    if (!state.users) return;
    $('team-status').hidden = state.users.length > 0;
    $('team').replaceChildren(...state.users.map((user) => {
      const owner = user.role === 'owner';
      const status = statusOf(user);
      return el('li', { class: `team-row${user.active ? '' : ' inactive'}` },
        el('div', { class: 'team-main' },
          el('p', { class: 'team-name', text: user.name }),
          el('p', { class: 'team-email', text: user.email }),
          el('p', { class: 'team-meta' },
            el('span', { class: `pill role-pill role-${user.role}`, text: t(`team.roles.${user.role}`) }),
            el('span', { class: `pill status-pill status-${status}`, text: t(`team.status.${status}`) }),
            el('span', { class: 'muted', text: lastLogin(user.lastLoginAt) }))),
        // The church's owner is managed through the church (the header actions), never here.
        owner || own ? null : el('div', { class: 'team-actions' },
          el('button', { type: 'button', class: 'secondary', 'data-icon': 'edit', text: t('team.edit'), 'aria-label': t('team.editFor', { name: user.name }), onclick: () => openEdit(user) }),
          state.emailEnabled && user.active && !user.lastLoginAt
            ? el('button', { type: 'button', class: 'secondary', 'data-icon': 'mail', text: t('team.resendInvite'), 'aria-label': t('team.resendInviteFor', { name: user.name }), onclick: () => sendLink('invite', user) }) : null,
          state.emailEnabled && user.active
            ? el('button', { type: 'button', class: 'secondary', 'data-icon': 'mail', text: t('team.sendReset'), 'aria-label': t('team.sendResetFor', { name: user.name }), onclick: () => sendLink('reset-link', user) }) : null,
          el('button', { type: 'button', class: 'secondary', 'data-icon': 'key', text: t('team.reset'), 'aria-label': t('team.resetFor', { name: user.name }), onclick: () => openConfirm('userReset', user) }),
          user.active
            ? el('button', { type: 'button', class: 'secondary danger-text', 'data-icon': 'close', text: t('team.deactivate'), 'aria-label': t('team.deactivateFor', { name: user.name }), onclick: () => openConfirm('userDeactivate', user) })
            : el('button', { type: 'button', class: 'secondary', 'data-icon': 'restart', text: t('team.reactivate'), 'aria-label': t('team.reactivateFor', { name: user.name }), onclick: () => openConfirm('userReactivate', user) })));
    }));
  }

  async function loadTeam() {
    const res = await api(path('/users'));
    if (!res.ok) {
      $('team-status').hidden = false;
      $('team-status').textContent = res.body.error || t('common.networkError');
      return;
    }
    state.users = res.body.users;
    state.emailEnabled = Boolean(res.body.emailEnabled);
    renderTeam();
  }

  // The invitation again / a reset link by email (routes/platform.js) -> a page message.
  async function sendLink(suffix, user) {
    say('page-message', '', 'success');
    try {
      const res = await api(path(`/users/${user.id}/${suffix}`), { method: 'POST' });
      if (!res.ok) return say('page-message', res.body.error || t('common.networkError'), 'error');
      replaceUser(res.body.user);
      say('page-message', t(suffix === 'invite' ? 'team.invited' : 'team.resetLinkSent', { email: res.body.sentTo }), 'success');
      return true;
    } catch (err) {
      say('page-message', t('common.networkError'), 'error');
    }
    return false;
  }

  function replaceUser(user) {
    state.users = state.users.map((u) => (u.id === user.id ? user : u));
    renderTeam();
  }

  // --- Ecrane ------------------------------------------------------------------------------

  function lastSeen(screen) {
    if (screen.online) return t('screens.onlineNow');
    if (!screen.lastSeenAt) return t('screens.neverSeen');
    return t('screens.lastSeen', { when: stamp(screen.lastSeenAt) });
  }

  function renderScreens() {
    if (!state.screens) return;
    $('screens-status').hidden = state.screens.length > 0;
    $('screens-status').textContent = state.screens.length ? '' : t('screens.empty');
    $('screens').replaceChildren(...state.screens.map((screen) => el('li', { class: 'screen-row' },
      el('span', { class: `online-dot${screen.online ? ' on' : ''}`, 'aria-hidden': 'true' }),
      el('span', { class: 'screen-text' },
        el('span', { class: 'screen-name', text: screen.name }),
        el('span', { class: 'screen-meta', text: `${screen.online ? t('screens.online') : t('screens.offline')} · ${lastSeen(screen)}` })),
      el('span', { class: 'screen-tools' },
        el('button', { type: 'button', class: 'secondary danger-text', 'data-icon': 'close', text: t('screens.revoke'), 'aria-label': t('screens.revokeLabel', { name: screen.name }), onclick: () => openConfirm('screenRevoke', screen) })))));
  }

  async function loadScreens() {
    const res = await api(path('/screens'));
    if (!res.ok) {
      $('screens-status').hidden = false;
      $('screens-status').textContent = res.body.error || t('common.networkError');
      return;
    }
    state.screens = res.body.screens;
    renderScreens();
  }

  // --- tabs --------------------------------------------------------------------------------

  const TABS = ['overview', 'team', 'screens'];
  const tabs = setupTabs(TABS.map((name) => $(`tab-${name}`)), (index) => {
    state.tab = TABS[index];
    for (const name of TABS) $(`panel-${name}`).hidden = name !== state.tab;
    const url = new URL(window.location.href);
    if (state.tab === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', state.tab);
    window.history.replaceState(null, '', url);
    if (state.tab === 'team' && !state.users) loadTeam().catch(() => {});
    if (state.tab === 'screens') loadScreens().catch(() => {});
  });

  // --- the church-level actions (the same as on /platform) --------------------------------

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  $('act-deactivate').addEventListener('click', () => openConfirm('deactivate', state.admin));
  $('act-reactivate').addEventListener('click', () => openConfirm('reactivate', state.admin));
  $('act-cancel-delete').addEventListener('click', () => openConfirm('cancelDelete', state.admin));

  // "Șterge biserica": the 7-day delay and the final backup explained; the name typed exactly.
  $('act-delete').addEventListener('click', () => {
    const a = state.admin;
    $('delete-heading').textContent = t('platform.confirm.deleteHeading', { name: a.name });
    $('delete-text').textContent = t('platform.confirm.deleteText', { name: a.name });
    $('delete-name').value = '';
    $('delete-submit').disabled = true;
    say('delete-message', '', 'error');
    $('delete-dialog').showModal();
    $('delete-name').focus();
  });
  $('delete-name').addEventListener('input', () => {
    $('delete-submit').disabled = $('delete-name').value !== state.admin.name;
  });
  $('delete-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('delete-submit').disabled = true;
    try {
      const res = await api(path('/delete'), { method: 'POST', body: { confirmName: $('delete-name').value } });
      if (!res.ok) return say('delete-message', res.body.error || t('common.networkError'), 'error');
      $('delete-dialog').close();
      await load();
      say('page-message', t('platform.deleteScheduled', { name: state.admin.name, date: dateText(state.admin.deleteAt) }), 'success');
    } catch (err) {
      say('delete-message', t('common.networkError'), 'error');
    } finally {
      $('delete-submit').disabled = $('delete-name').value !== state.admin.name;
    }
  });
  $('act-reset').addEventListener('click', () => openConfirm('reset', state.admin));
  $('act-quota').addEventListener('click', () => {
    const a = state.admin;
    $('quota-heading').textContent = t('platform.quotaHeading', { name: a.name });
    $('quota-mb').value = a.mediaMaxOverride ? String(Math.round(a.mediaMaxBytes / MB)) : '';
    $('quota-mb').placeholder = String(Math.round(state.defaultQuota / MB));
    $('quota-hint').textContent = t('platform.quotaHint', { default: size(state.defaultQuota) });
    say('quota-message', '', 'error');
    $('quota-dialog').showModal();
    $('quota-mb').focus();
  });

  $('quota-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = $('quota-mb').value.trim();
    const res = await api(path(), { method: 'PATCH', body: { mediaMaxMb: value === '' ? null : Number(value) } });
    if (!res.ok) return say('quota-message', res.body.error || t('common.networkError'), 'error');
    $('quota-dialog').close();
    await load();
    say('page-message', t('platform.quotaSaved', { name: state.admin.name, max: size(state.admin.mediaMaxBytes) }), 'success');
  });

  // action: deactivate | reactivate | reset (the church) | userReset | userDeactivate |
  // userReactivate (a person) | screenRevoke (a screen).
  const CONFIRM = {
    deactivate: { key: 'platform.confirm.deactivate', danger: true },
    reactivate: { key: 'platform.confirm.reactivate' },
    cancelDelete: { key: 'platform.confirm.cancelDelete' },
    reset: { key: 'platform.confirm.reset' },
    userReset: { key: 'team.confirm.reset' },
    userDeactivate: { key: 'team.confirm.deactivate', danger: true },
    userReactivate: { key: 'team.confirm.reactivate' },
    screenRevoke: { key: 'platformChurch.confirm.revoke', danger: true },
  };

  function openConfirm(action, target) {
    state.confirm = { action, target };
    const { key, danger } = CONFIRM[action];
    const vars = { name: target.name, email: state.admin.ownerEmail || '' };
    $('confirm-heading').textContent = t(`${key}Heading`, vars);
    $('confirm-text').textContent = t(`${key}Text`, vars);
    $('confirm-yes').textContent = t(`${key}Yes`, vars);
    $('confirm-yes').className = danger ? 'danger' : '';
    say('confirm-message', '', 'error');
    $('confirm-dialog').showModal();
  }

  $('confirm-yes').addEventListener('click', async () => {
    const { action, target } = state.confirm;
    $('confirm-yes').disabled = true;
    try {
      let res;
      if (action === 'deactivate' || action === 'reactivate') res = await api(path(`/${action}`), { method: 'POST' });
      else if (action === 'cancelDelete') res = await api(path('/cancel-delete'), { method: 'POST' });
      else if (action === 'reset') res = await api(path('/reset-owner-password'), { method: 'POST' });
      else if (action === 'screenRevoke') res = await api(path(`/screens/${target.id}/revoke`), { method: 'POST' });
      else res = await api(path(`/users/${target.id}/${{ userReset: 'reset-password', userDeactivate: 'deactivate', userReactivate: 'reactivate' }[action]}`), { method: 'POST' });
      if (!res.ok) return say('confirm-message', res.body.error || t('common.networkError'), 'error');
      $('confirm-dialog').close();
      if (action === 'reset') {
        await load();
        showResult('platform.resetHeading', { name: state.admin.name, owner: res.body.owner.name }, res.body.owner.email, res.body.temporaryPassword);
      } else if (action === 'deactivate' || action === 'reactivate' || action === 'cancelDelete') {
        await load();
        say('page-message', t(action === 'cancelDelete' ? 'platform.deleteCancelled' : `platform.${action}d`, { name: state.admin.name }), 'success');
      } else if (action === 'screenRevoke') {
        await loadScreens();
        say('page-message', t('platformChurch.revoked', { name: target.name }), 'success');
      } else {
        replaceUser(res.body.user);
        if (action === 'userReset') showResult('team.resetHeading', { name: res.body.user.name }, res.body.user.email, res.body.temporaryPassword);
        else say('page-message', t(action === 'userDeactivate' ? 'team.deactivated' : 'team.reactivated', { name: target.name }), 'success');
      }
    } finally {
      $('confirm-yes').disabled = false;
    }
  });

  // --- a person: add, edit --------------------------------------------------------------

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
      const res = await api(path('/users'), { method: 'POST', body: { name: $('add-name').value, email: $('add-email').value, role } });
      if (!res.ok) return say('add-message', res.body.error || t('common.networkError'), 'error');
      await loadTeam();
      $('add-dialog').close();
      if (byEmail && await sendLink('invite', res.body.user)) return;
      showResult('team.createdHeading', { name: res.body.user.name }, res.body.user.email, res.body.temporaryPassword);
    } catch (err) {
      say('add-message', t('common.networkError'), 'error');
    } finally {
      $('add-submit').disabled = false;
      $('add-submit-email').disabled = false;
    }
  });

  function openEdit(user) {
    state.editing = user;
    $('edit-name').value = user.name;
    $('edit-role').value = user.role;
    say('edit-message', '', 'error');
    $('edit-dialog').showModal();
    $('edit-name').focus();
  }

  $('edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = state.editing;
    const res = await api(path(`/users/${user.id}`), { method: 'PATCH', body: { name: $('edit-name').value, role: $('edit-role').value } });
    if (!res.ok) return say('edit-message', res.body.error || t('common.networkError'), 'error');
    replaceUser(res.body.user);
    $('edit-dialog').close();
    say('page-message', t('team.saved', { name: res.body.user.name }), 'success');
  });

  // --- the result card (shown once) ---------------------------------------------------------

  function welcomeMessage() {
    const { email, password } = state.result;
    return t('platform.welcome', { appName: document.documentElement.dataset.appName || '', church: state.admin.name, url: baseUrl(), email, password });
  }

  function renderResult() {
    const { headingKey, vars, email, password } = state.result;
    $('result-heading').textContent = t(headingKey, vars);
    $('result-email').textContent = email;
    $('result-password').textContent = password;
    $('result-message').value = welcomeMessage();
  }

  function showResult(headingKey, vars, email, password) {
    state.result = { headingKey, vars, email, password };
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
  $('result-dialog').addEventListener('close', () => {
    state.result = null;
    $('result-password').textContent = '';
    $('result-message').value = '';
  });

  // --- load ------------------------------------------------------------------------------------

  function render() {
    if (!state.admin) return;
    renderHead();
    renderOverview();
    renderTeam();
    renderScreens();
  }

  async function load() {
    const res = await api(path());
    if (!res.ok) {
      $('status').hidden = false;
      $('status').removeAttribute('data-i18n');
      $('status').textContent = res.status === 404 ? t('errors.platformAdminNotFound') : (res.body.error || t('common.networkError'));
      return;
    }
    Object.assign(state, { admin: res.body.admin, defaultQuota: res.body.defaultMediaMaxBytes, baseUrl: res.body.baseUrl });
    $('status').hidden = true;
    $('church').hidden = false;
    render();
  }

  document.addEventListener('i18n:change', () => {
    render();
    if (state.result) renderResult();
  });

  load().then(() => {
    const asked = new URLSearchParams(window.location.search).get('tab');
    tabs.select(Math.max(0, TABS.indexOf(asked)), false);
  }).catch(() => {
    $('status').removeAttribute('data-i18n');
    $('status').textContent = t('common.networkError');
  });
})();
