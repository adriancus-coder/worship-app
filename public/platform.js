'use strict';

// The platform page (/platform, the platform owner only): the churches on this server with
// their users, songs, events, storage (a bar against the church's quota) and last activity,
// and the total against the disk. "+ Biserică nouă" creates a church and its owner with a
// temporary password shown once (the same card as /team). Per church: deactivate /
// reactivate, a new password for its owner, its media quota. The platform's own church is
// marked and cannot be deactivated.

(function () {
  const { api, el, setTitle, formatDate } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const state = { admins: [], baseUrl: null, disk: null, defaultQuota: 0, confirm: null, quota: null, result: null };
  const MB = 1024 * 1024;

  const baseUrl = () => state.baseUrl || window.location.origin;

  function size(bytes) {
    if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
    return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  }

  function say(id, text, kind) {
    $(id).className = `message${kind ? ` ${kind}` : ''}`;
    $(id).textContent = text || '';
  }

  function lastActivity(ms) {
    if (!ms) return t('platform.noActivity');
    const d = new Date(ms);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return t('platform.lastActivity', { when: formatDate(day, String(new Date().getFullYear())) });
  }

  function bar(used, total, label) {
    const pct = total ? Math.min(100, (used / total) * 100) : 0;
    return el('div', { class: `storage-bar${pct > 85 ? ' high' : ''}`, role: 'img', 'aria-label': label },
      el('span', { class: 'storage-fill', style: `width: ${pct.toFixed(1)}%` }));
  }

  // --- list -------------------------------------------------------------------------

  function renderTotal() {
    const disk = state.disk;
    if (!disk) return;
    const used = state.admins.reduce((sum, a) => sum + a.storageBytes, 0) + (disk.dbBytes || 0);
    $('total-heading').textContent = t('platform.total', { used: size(used), disk: size(disk.diskBytes), n: state.admins.length });
    const pct = disk.diskBytes ? Math.min(100, (used / disk.diskBytes) * 100) : 0;
    $('total-fill').style.width = `${pct.toFixed(1)}%`;
    $('total-bar').classList.toggle('high', pct > 70);
    $('total-hint').textContent = t('platform.totalHint', { free: size(disk.freeBytes), db: size(disk.dbBytes || 0) });
  }

  function render() {
    setTitle('platform.pageTitle');
    renderTotal();
    $('churches').replaceChildren(...state.admins.map((admin) => {
      const usage = t('platform.storage', { used: size(admin.storageBytes), max: size(admin.mediaMaxBytes) });
      return el('li', { class: `team-row church-row${admin.active ? '' : ' inactive'}${admin.platform ? ' platform' : ''}` },
        el('div', { class: 'team-main' },
          el('p', { class: 'team-name' }, el('span', { text: admin.name }),
            admin.platform ? el('span', { class: 'pill platform-pill', text: t('platform.platformChurch') }) : null),
          el('p', { class: 'team-email', text: admin.ownerEmail || '—' }),
          el('p', { class: 'team-meta' },
            el('span', { class: `pill status-pill status-${admin.active ? 'active' : 'inactive'}`, text: t(admin.active ? 'platform.active' : 'platform.inactive') }),
            el('span', { class: 'muted', text: t('platform.counts', { users: admin.users, songs: admin.songs, events: admin.events }) }),
            el('span', { class: 'muted', text: lastActivity(admin.lastActivityAt) })),
          el('div', { class: 'church-storage' },
            el('p', { class: 'hint', text: `${usage}${admin.mediaMaxOverride ? ` · ${t('platform.quotaCustom')}` : ''}` }),
            bar(admin.storageBytes, admin.mediaMaxBytes, usage))),
        el('div', { class: 'team-actions' },
          el('button', { type: 'button', class: 'secondary', 'data-icon': 'key', text: t('platform.reset'), 'aria-label': t('platform.resetFor', { name: admin.name }), onclick: () => openConfirm('reset', admin) }),
          el('button', { type: 'button', class: 'secondary', 'data-icon': 'upload', text: t('platform.quota'), 'aria-label': t('platform.quotaFor', { name: admin.name }), onclick: () => openQuota(admin) }),
          admin.platform ? null : (admin.active
            ? el('button', { type: 'button', class: 'secondary danger-text', 'data-icon': 'close', text: t('platform.deactivate'), 'aria-label': t('platform.deactivateFor', { name: admin.name }), onclick: () => openConfirm('deactivate', admin) })
            : el('button', { type: 'button', class: 'secondary', 'data-icon': 'restart', text: t('platform.reactivate'), 'aria-label': t('platform.reactivateFor', { name: admin.name }), onclick: () => openConfirm('reactivate', admin) }))));
    }));
  }

  async function load() {
    const res = await api('/api/platform/admins');
    if (!res.ok) {
      $('status').removeAttribute('data-i18n');
      $('status').textContent = res.body.error || t('common.networkError');
      return;
    }
    Object.assign(state, { admins: res.body.admins, baseUrl: res.body.baseUrl, disk: res.body.disk, defaultQuota: res.body.defaultMediaMaxBytes });
    $('status').hidden = true;
    render();
  }

  function replaceAdmin(admin) {
    state.admins = state.admins.map((a) => (a.id === admin.id ? admin : a));
    render();
  }

  // --- dialogs ----------------------------------------------------------------------

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  $('add-church').addEventListener('click', () => {
    $('add-form').reset();
    say('add-message', '', 'error');
    $('add-dialog').showModal();
    $('add-name').focus();
  });

  $('add-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('add-submit').disabled = true;
    try {
      const res = await api('/api/platform/admins', { method: 'POST', body: { name: $('add-name').value, ownerName: $('add-owner-name').value, ownerEmail: $('add-owner-email').value } });
      if (!res.ok) return say('add-message', res.body.error || t('common.networkError'), 'error');
      await load();
      $('add-dialog').close();
      showResult('created', res.body.admin, { name: $('add-owner-name').value.trim(), email: res.body.admin.ownerEmail }, res.body.temporaryPassword);
    } catch (err) {
      say('add-message', t('common.networkError'), 'error');
    } finally {
      $('add-submit').disabled = false;
    }
  });

  function openConfirm(action, admin) {
    state.confirm = { action, admin };
    $('confirm-heading').textContent = t(`platform.confirm.${action}Heading`, { name: admin.name });
    $('confirm-text').textContent = t(`platform.confirm.${action}Text`, { name: admin.name, email: admin.ownerEmail || '' });
    $('confirm-yes').textContent = t(`platform.confirm.${action}Yes`);
    $('confirm-yes').className = action === 'deactivate' ? 'danger' : '';
    say('confirm-message', '', 'error');
    $('confirm-dialog').showModal();
  }

  $('confirm-yes').addEventListener('click', async () => {
    const { action, admin } = state.confirm;
    const path = action === 'reset' ? 'reset-owner-password' : action;
    $('confirm-yes').disabled = true;
    try {
      const res = await api(`/api/platform/admins/${admin.id}/${path}`, { method: 'POST' });
      if (!res.ok) return say('confirm-message', res.body.error || t('common.networkError'), 'error');
      replaceAdmin(res.body.admin);
      $('confirm-dialog').close();
      if (action === 'reset') showResult('reset', res.body.admin, res.body.owner, res.body.temporaryPassword);
      else say('page-message', t(`platform.${action}d`, { name: admin.name }), 'success');
    } finally {
      $('confirm-yes').disabled = false;
    }
  });

  function openQuota(admin) {
    state.quota = admin;
    $('quota-heading').textContent = t('platform.quotaHeading', { name: admin.name });
    $('quota-mb').value = admin.mediaMaxOverride ? String(Math.round(admin.mediaMaxBytes / MB)) : '';
    $('quota-mb').placeholder = String(Math.round(state.defaultQuota / MB));
    $('quota-hint').textContent = t('platform.quotaHint', { default: size(state.defaultQuota) });
    say('quota-message', '', 'error');
    $('quota-dialog').showModal();
    $('quota-mb').focus();
  }

  $('quota-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const admin = state.quota;
    const value = $('quota-mb').value.trim();
    const res = await api(`/api/platform/admins/${admin.id}`, { method: 'PATCH', body: { mediaMaxMb: value === '' ? null : Number(value) } });
    if (!res.ok) return say('quota-message', res.body.error || t('common.networkError'), 'error');
    replaceAdmin(res.body.admin);
    $('quota-dialog').close();
    say('page-message', t('platform.quotaSaved', { name: admin.name, max: size(res.body.admin.mediaMaxBytes) }), 'success');
  });

  // --- the result card (shown once) -------------------------------------------------

  function welcomeMessage() {
    const { admin, owner, password } = state.result;
    return t('platform.welcome', { appName: document.documentElement.dataset.appName || '', church: admin.name, url: baseUrl(), email: owner.email, password });
  }

  function renderResult() {
    const { kind, admin, owner, password } = state.result;
    $('result-heading').textContent = t(kind === 'created' ? 'platform.createdHeading' : 'platform.resetHeading', { name: admin.name, owner: owner.name });
    $('result-email').textContent = owner.email;
    $('result-password').textContent = password;
    $('result-message').value = welcomeMessage();
  }

  function showResult(kind, admin, owner, password) {
    state.result = { kind, admin, owner, password };
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
  // The password is gone once the card closes.
  $('result-dialog').addEventListener('close', () => {
    state.result = null;
    $('result-password').textContent = '';
    $('result-message').value = '';
  });

  document.addEventListener('i18n:change', () => {
    render();
    if (state.result) renderResult();
  });

  load().catch(() => {
    $('status').textContent = t('common.networkError');
  });
})();
