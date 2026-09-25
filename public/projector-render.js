'use strict';

// Renders a projector frame (lib/projector.js) into a container: the /screen page (whole
// viewport) and the leader's small live preview use the same code, so the preview shows
// exactly what the screens show.
//
// Text is white on black, centred, and auto-fitted: the largest font size (between a
// minimum and a maximum, relative to the container height) at which every line fits inside
// safe margins of 5 % on each side. Song line breaks are kept; long lines wrap. Content
// fades in (150 ms); black appears at once.
//
// Backgrounds (frame.background, lib/backgrounds.js) sit on their own layer under the text:
// an image (cover-fit) or a silent looping video, dimmed and blurred as set per background,
// with a stronger text shadow when enabled. New lyrics on the same background never touch
// that layer; another background cross-fades (300 ms, none with reduced motion). Loaded
// backgrounds are kept (by media id) so they still show offline; one that cannot load
// leaves the screen black behind the text. frame.nextBackground is loaded ahead.

(function () {
  const MIN_FONT = 0.025; // of the container height
  const MAX_FONT = 0.12;
  const FADE_MS = 150;
  const BG_FADE_MS = 300;
  const BG_LOAD_MS = 15000; // a background not loaded by then shows as black
  const BG_KEEP = 6; // loaded backgrounds kept for reuse / offline
  const BLUR_REFERENCE_WIDTH = 1920; // blur is given in px of a 1920-wide screen
  const reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  // videoPlaceholder: the small preview shows "▶ title" for a video frame (the screen itself
  // plays it on its own layer, see video-player.js).
  function create(container, { resolveLogo = async (url) => url, videoPlaceholder = false } = {}) {
    container.classList.add('projector');
    const backdrop = document.createElement('div');
    backdrop.className = 'projector-backdrop';
    const stage = document.createElement('div');
    stage.className = 'projector-stage';
    container.replaceChildren(backdrop, stage);
    let current = null;
    let token = 0;
    const loaded = new Map(); // media id -> { node, ready: Promise<boolean> }
    let shown = null; // { id, layer, bg } on the backdrop
    let bgToken = 0;

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function linesBlock(lines, className) {
      const block = el('div', className);
      for (const line of lines) block.append(el('div', 'projector-line', line || ' '));
      return block;
    }

    // The largest font size at which the text box fits inside the safe area.
    function fit() {
      const box = stage.firstElementChild;
      if (!box || !box.classList.contains('projector-text')) return;
      const height = container.clientHeight;
      const width = container.clientWidth;
      if (!height || !width) return;
      const maxW = width * 0.9;
      const maxH = height * 0.9;
      let lo = Math.max(6, height * MIN_FONT);
      let hi = Math.max(lo, height * MAX_FONT);
      box.style.fontSize = `${hi}px`;
      if (box.scrollWidth <= maxW && box.scrollHeight <= maxH) return;
      for (let i = 0; i < 18 && hi - lo > 0.5; i++) {
        const mid = (lo + hi) / 2;
        box.style.fontSize = `${mid}px`;
        if (box.scrollWidth <= maxW && box.scrollHeight <= maxH) lo = mid;
        else hi = mid;
      }
      box.style.fontSize = `${lo}px`;
    }

    // --- background layer ---

    // Starts loading a background (once per media id); resolves true when it can be shown.
    function load(bg) {
      const hit = loaded.get(bg.id);
      if (hit && hit.kind === bg.kind) {
        loaded.delete(bg.id); // most recently used last
        loaded.set(bg.id, hit);
        return hit;
      }
      let node;
      let ready;
      if (bg.kind === 'loop') {
        node = el('video', 'projector-bg-media');
        node.muted = true;
        node.defaultMuted = true;
        node.loop = true;
        node.playsInline = true;
        node.autoplay = true;
        node.preload = 'auto';
        node.setAttribute('aria-hidden', 'true');
        ready = new Promise((resolve) => {
          node.addEventListener('loadeddata', () => resolve(true), { once: true });
          node.addEventListener('error', () => resolve(false), { once: true });
          setTimeout(() => resolve(false), BG_LOAD_MS);
        });
        node.src = bg.url;
      } else {
        node = el('img', 'projector-bg-media');
        node.alt = '';
        node.src = bg.url;
        ready = Promise.race([
          node.decode().then(() => true, () => false),
          new Promise((resolve) => setTimeout(() => resolve(false), BG_LOAD_MS)),
        ]);
      }
      const entry = { kind: bg.kind, node, ready };
      ready.then((ok) => { if (!ok && loaded.get(bg.id) === entry) loaded.delete(bg.id); }); // retried next time
      loaded.set(bg.id, entry);
      for (const id of loaded.keys()) {
        if (loaded.size <= BG_KEEP) break;
        if ((shown && shown.id === id) || id === bg.id) continue;
        const old = loaded.get(id);
        if (old.node.tagName === 'VIDEO') old.node.removeAttribute('src');
        loaded.delete(id);
      }
      return entry;
    }

    // Dim, blur (scaled to this container's width) and the text shadow of a shown background.
    function style(layer, bg) {
      const media = layer.firstElementChild;
      const blur = (bg.blur || 0) * ((container.clientWidth || BLUR_REFERENCE_WIDTH) / BLUR_REFERENCE_WIDTH);
      media.style.filter = blur > 0 ? `blur(${blur.toFixed(2)}px)` : '';
      media.style.transform = blur > 0 ? 'scale(1.06)' : ''; // no soft edges from the blur
      layer.lastElementChild.style.opacity = String(Math.min(80, Math.max(0, bg.dim || 0)) / 100);
    }

    function fadeMs(instant) {
      return instant || (reducedMotion && reducedMotion.matches) ? 0 : BG_FADE_MS;
    }

    // Shows a background (null: none) under the text; instant for black.
    async function setBackground(bg, instant) {
      container.classList.toggle('projector-shadowed', Boolean(bg && bg.shadow));
      if (bg && shown && shown.id === bg.id) { // the same background: only its settings
        shown.bg = bg;
        style(shown.layer, bg);
        bgToken += 1; // a background still loading is no longer wanted
        return;
      }
      if (!bg && !shown) {
        bgToken += 1;
        return;
      }
      const mine = ++bgToken;
      let layer = null;
      if (bg) {
        const entry = load(bg);
        const ok = await entry.ready;
        if (mine !== bgToken) return;
        if (ok) {
          layer = el('div', 'projector-bg-layer');
          layer.append(entry.node, el('div', 'projector-dim'));
          style(layer, bg);
        }
      }
      const old = shown;
      shown = layer ? { id: bg.id, layer, bg } : null;
      if (!layer && !old) return;
      const ms = fadeMs(instant);
      if (layer) {
        layer.style.opacity = ms ? '0' : '1';
        backdrop.append(layer);
        if (layer.firstElementChild.tagName === 'VIDEO') layer.firstElementChild.play().catch(() => {});
        if (ms) {
          void layer.offsetWidth;
          layer.style.transition = `opacity ${ms}ms ease-in-out`;
          layer.style.opacity = '1';
        }
      }
      if (old) {
        // The old layer goes once the new one is fully in (or itself has faded out).
        const drop = () => { if (old.layer.parentNode) old.layer.remove(); };
        if (!ms || !container.getClientRects().length) drop(); // hidden: no transition runs
        else {
          const fading = layer || old.layer;
          if (!layer) {
            old.layer.style.transition = `opacity ${ms}ms ease-in-out`;
            old.layer.style.opacity = '0';
          }
          fading.addEventListener('transitionend', drop, { once: true });
          setTimeout(drop, ms + 1000); // no transitionend (hidden tab, replaced meanwhile)
        }
      }
    }

    function textBox(frame) {
      const box = el('div', 'projector-text');
      switch (frame.kind) {
        case 'lyrics':
          box.append(linesBlock(frame.lines, 'projector-lyrics'));
          break;
        case 'verse':
          if (frame.reference) box.append(el('div', 'projector-reference', frame.reference));
          if (frame.text) box.append(linesBlock(frame.text.split('\n'), 'projector-body'));
          break;
        case 'announcement':
          if (frame.title) box.append(el('div', 'projector-heading', frame.title));
          if (frame.body) box.append(linesBlock(frame.body.split('\n'), 'projector-body'));
          break;
        default:
          box.append(el('div', 'projector-title', frame.title || ''));
      }
      return box;
    }

    // What to put on the stage for a frame; null = black.
    async function content(frame) {
      if (frame.kind === 'lyrics' || frame.kind === 'verse' || frame.kind === 'announcement' || frame.kind === 'title') {
        return textBox(frame);
      }
      if ((frame.kind === 'logo' || frame.kind === 'idle') && frame.logoUrl) {
        const src = await resolveLogo(frame.logoUrl);
        if (!src) return null;
        const img = el('img', 'projector-logo');
        img.alt = '';
        img.src = src;
        await img.decode().catch(() => {});
        return img;
      }
      if (frame.kind === 'video' && videoPlaceholder && frame.video) {
        const box = el('div', 'projector-text projector-video-placeholder');
        box.append(el('div', 'projector-title', `${frame.video.state === 'paused' ? '❚❚' : '▶'} ${frame.video.media.title || frame.video.media.name || ''}`));
        return box;
      }
      return null; // black, idle without a logo, a video on the screen's own layer, unknown
    }

    // The same picture: the version, a prepared video (its own layer) and the background (its
    // own layer) do not count, except for the preview's video placeholder.
    const picture = (f) => JSON.stringify({ ...f, version: 0, background: undefined, nextBackground: undefined,
      video: f.kind === 'video' && videoPlaceholder ? f.video : undefined });
    const sameFrame = (a, b) => a && b && picture(a) === picture(b);

    async function show(frame) {
      if (!frame) return;
      setBackground(frame.background || null, frame.kind === 'black');
      if (frame.nextBackground) load(frame.nextBackground);
      if (sameFrame(frame, current)) {
        current = frame;
        return;
      }
      current = frame;
      const mine = ++token;
      const node = await content(frame);
      if (mine !== token) return; // a newer frame arrived meanwhile
      if (!node) {
        stage.classList.remove('visible');
        stage.replaceChildren();
        return;
      }
      stage.classList.remove('visible');
      stage.style.transition = 'none';
      stage.replaceChildren(node);
      fit();
      void stage.offsetWidth; // restart the fade
      stage.style.transition = `opacity ${FADE_MS}ms ease-out`;
      stage.classList.add('visible');
    }

    function resized() {
      fit();
      if (shown) style(shown.layer, shown.bg);
    }
    if ('ResizeObserver' in window) new ResizeObserver(resized).observe(container);
    else window.addEventListener('resize', resized);

    return { show, fit, get frame() { return current; } };
  }

  // A frame shows lyrics / text (the fullscreen hint must never cover it).
  function isContent(frame) {
    return Boolean(frame) && ['lyrics', 'verse', 'announcement', 'title', 'video'].includes(frame.kind);
  }

  window.PROJECTOR_RENDER = { create, isContent };
})();
