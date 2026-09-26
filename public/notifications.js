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

  document.addEventListener('i18n:change', () => { render(); say(''); });
  refresh().catch(() => say(t('common.networkError'), 'error'));
})();
