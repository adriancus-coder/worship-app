'use strict';

// Projector screens (/screens, owner and leader): pair a screen with the code it shows,
// list the paired screens (online, last seen), rename and revoke them.

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const REFRESH_MS = 15000;

  const state = { screens: null, renaming: null, revoking: null };

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
        el('button', { type: 'button', class: 'secondary', text: t('screens.rename'), 'aria-label': t('screens.renameLabel', { name: screen.name }), onclick: () => openRename(screen) }),
        el('button', { type: 'button', class: 'secondary', text: t('screens.revoke'), 'aria-label': t('screens.revokeLabel', { name: screen.name }), onclick: () => openRevoke(screen) })))));
  }

  async function load() {
    const res = await api('/api/screens');
    if (!res.ok) {
      setStatus(res.body.error || t('common.networkError'));
      return;
    }
    state.screens = res.body.screens;
    render();
  }

  // --- pairing -----------------------------------------------------------------------

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
  });

  setTitle('screens.pageTitle');

  load().catch(() => setStatus(t('common.networkError')));
  setInterval(() => {
    if (!document.hidden) load().catch(() => {});
  }, REFRESH_MS);
})();
