'use strict';

// "Deschide ecranul proiectorului" (the leader's live page, the operator console): opens the
// /screen window, paired at once with a one-time claim link. With the Window Management API
// (Chrome / Edge, one-time permission) it opens fullscreen on a display other than this one;
// otherwise as a normal window the user drags to the projector (+ F11).
//
//   PROJECTOR_WINDOW.setup({ button, hint, message, api, t });

(function () {
  const canPlace = 'getScreenDetails' in window;
  let details = null;

  async function screenDetails(ask) {
    if (!canPlace) return null;
    if (details) return details;
    try {
      const permission = await navigator.permissions.query({ name: 'window-management' });
      if (permission.state === 'denied' || (permission.state === 'prompt' && !ask)) return null;
    } catch (err) {
      if (!ask) return null; // permission name unknown: only ask on a click
    }
    try {
      details = await window.getScreenDetails();
    } catch (err) {
      details = null; // denied
    }
    return details;
  }

  function otherScreen(found) {
    if (!found) return null;
    const others = found.screens.filter((s) => s !== found.currentScreen);
    return others.find((s) => !s.isPrimary) || others[0] || null;
  }

  function setup({ button, hint, message, api, t }) {
    function say(text, kind) {
      message.className = `message${kind ? ` ${kind}` : ''}`;
      message.textContent = text || '';
    }
    if (hint) hint.hidden = !canPlace;
    screenDetails(false); // already granted earlier: no prompt, the window opens at once
    button.addEventListener('click', async () => {
      say('');
      const target = otherScreen(await screenDetails(true));
      const features = target
        ? `popup,left=${target.availLeft},top=${target.availTop},width=${target.availWidth},height=${target.availHeight},fullscreen`
        : 'popup,width=1280,height=720';
      // Opened right away (still inside the click); the claim link is filled in after.
      const win = window.open('about:blank', 'wa-projector', features);
      if (!win) {
        say(t('live.projector.blocked'), 'error');
        return;
      }
      const res = await api('/api/screens/auto-claim', { method: 'POST', body: { name: t('live.projector.windowName') } });
      if (!res.ok) {
        win.close();
        say(res.body.error || t('common.networkError'), 'error');
        return;
      }
      win.location.href = res.body.claimUrl;
      say(target ? t('live.projector.placed') : t('live.projector.dragHint'), target ? 'success' : null);
    });
    return { say };
  }

  window.PROJECTOR_WINDOW = { setup };
})();
