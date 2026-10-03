'use strict';

// Tap or hold on a list item (the live Program lists, the event editor):
//   short tap / click                 -> tap()   (the primary action)
//   long press (500 ms, still finger) -> hold()  (the secondary action), with a short buzz
//                                        (navigator.vibrate) and a press animation
//   right-click, the context-menu key, Shift+Enter -> hold() (desktop equivalents)
// Moving more than 10 px during a press cancels it (a scroll): neither action runs. A long
// press never runs tap(), also when hold is null (then it does nothing). The long press is
// a shortcut: every page keeps a visible control for the same secondary action.
//
//   PRESS.bind(button, { tap, hold })       // hold: a function or null
//   PRESS.hint(key, textKey)                // the "tap · hold" hint line, once per device
//                                           // (until dismissed or the first long press)

(function () {
  const HOLD_MS = 500;
  const MOVE_PX = 10;
  const HINT_PREFIX = 'wa_hint_press_';
  const hints = new Map(); // key -> the hint node on this page

  function buzz() {
    try {
      if (navigator.vibrate) navigator.vibrate(15);
    } catch (err) {
      // no vibration here
    }
  }

  // The finger (or the mouse button) is still down when a long press fires: the click its
  // release makes must not land on what the secondary action opened under it (the arrange
  // sheet's "Aplică" on a phone). Swallows that one click, wherever it lands.
  function guardRelease() {
    let timeout = null;
    const done = () => {
      clearTimeout(timeout);
      window.removeEventListener('click', swallowClick, true);
      window.removeEventListener('pointerdown', done, true);
      window.removeEventListener('pointerup', released, true);
      window.removeEventListener('pointercancel', released, true);
    };
    const swallowClick = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      done();
    };
    const released = () => { timeout = setTimeout(done, 800); };
    window.addEventListener('click', swallowClick, true);
    window.addEventListener('pointerdown', done, true);
    window.addEventListener('pointerup', released, true);
    window.addEventListener('pointercancel', released, true);
  }

  function bind(node, { tap, hold = null }) {
    let timer = null;
    let start = null;
    let swallow = false; // the click that follows a cancelled press (a scroll)
    let heldAt = 0;

    const clear = () => {
      clearTimeout(timer);
      timer = null;
      node.classList.remove('pressing');
    };

    function runHold() {
      heldAt = Date.now();
      if (!hold) return;
      node.classList.add('held');
      setTimeout(() => node.classList.remove('held'), 250);
      learned();
      hold();
    }

    node.classList.add('press-target');
    node.addEventListener('pointerdown', (event) => {
      if (node.disabled || event.button !== 0) return;
      swallow = false;
      start = { x: event.clientX, y: event.clientY };
      if (hold) node.classList.add('pressing');
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        node.classList.remove('pressing');
        guardRelease();
        if (hold) buzz();
        runHold();
      }, HOLD_MS);
    });
    node.addEventListener('pointermove', (event) => {
      if (!start || !timer) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_PX) {
        clear();
        swallow = true; // a scroll, not a tap
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      node.addEventListener(type, () => {
        clear();
        start = null;
      });
    }
    node.addEventListener('click', (event) => {
      if (swallow) {
        swallow = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      tap(event);
    });
    node.addEventListener('contextmenu', (event) => {
      event.preventDefault(); // no browser menu on a list item
      if (node.disabled || Date.now() - heldAt < 1000) return; // the touch long press already ran
      if (start && timer) guardRelease(); // a touch long press the browser reported first
      clear();
      runHold();
    });
    node.addEventListener('keydown', (event) => {
      swallow = false;
      if (node.disabled) return;
      if (event.key === 'ContextMenu' || (event.key === 'Enter' && event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        heldAt = Date.now();
        if (!hold) return;
        learned();
        hold();
      }
    });
    return node;
  }

  // --- the hint line ----------------------------------------------------------------

  function seen(key) {
    try {
      return window.localStorage.getItem(HINT_PREFIX + key) === '1';
    } catch (err) {
      return false;
    }
  }

  function dismiss(key) {
    try {
      window.localStorage.setItem(HINT_PREFIX + key, '1');
    } catch (err) {
      // no storage: hidden on this page only
    }
    const node = hints.get(key);
    if (node) node.remove();
    hints.delete(key);
  }

  // The first long press on the page: the hint has done its job.
  function learned() {
    for (const key of [...hints.keys()]) dismiss(key);
  }

  // A hint line, or null when this device has already dismissed it.
  function hint(key, textKey) {
    if (seen(key)) return null;
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const text = el('span', { class: 'press-hint-text' });
    const close = el('button', { type: 'button', class: 'secondary icon-button press-hint-close', 'data-icon': 'close', onclick: () => dismiss(key) });
    const node = el('p', { class: 'press-hint', id: `press-hint-${key}` }, text, close);
    const render = () => {
      text.textContent = t(textKey);
      close.setAttribute('aria-label', t('press.hintClose'));
    };
    render();
    document.addEventListener('i18n:change', render);
    hints.set(key, node);
    return node;
  }

  window.PRESS = { bind, hint, dismiss };
})();
