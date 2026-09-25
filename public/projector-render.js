'use strict';

// Renders a projector frame (lib/projector.js) into a container: the /screen page (whole
// viewport) and the leader's small live preview use the same code, so the preview shows
// exactly what the screens show.
//
// Text is white on black, centred, and auto-fitted: the largest font size (between a
// minimum and a maximum, relative to the container height) at which every line fits inside
// safe margins of 5 % on each side. Song line breaks are kept; long lines wrap. Content
// fades in (150 ms); black appears at once.

(function () {
  const MIN_FONT = 0.025; // of the container height
  const MAX_FONT = 0.12;
  const FADE_MS = 150;

  // videoPlaceholder: the small preview shows "▶ title" for a video frame (the screen itself
  // plays it on its own layer, see video-player.js).
  function create(container, { resolveLogo = async (url) => url, videoPlaceholder = false } = {}) {
    container.classList.add('projector');
    const stage = document.createElement('div');
    stage.className = 'projector-stage';
    container.replaceChildren(stage);
    let current = null;
    let token = 0;

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

    // The same picture: the version and a prepared video (its own layer) do not count, except
    // for the preview's video placeholder.
    const picture = (f) => JSON.stringify({ ...f, version: 0, video: f.kind === 'video' && videoPlaceholder ? f.video : undefined });
    const sameFrame = (a, b) => a && b && picture(a) === picture(b);

    async function show(frame) {
      if (!frame || sameFrame(frame, current)) {
        current = frame || current;
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

    if ('ResizeObserver' in window) new ResizeObserver(() => fit()).observe(container);
    else window.addEventListener('resize', fit);

    return { show, fit, get frame() { return current; } };
  }

  // A frame shows lyrics / text (the fullscreen hint must never cover it).
  function isContent(frame) {
    return Boolean(frame) && ['lyrics', 'verse', 'announcement', 'title', 'video'].includes(frame.kind);
  }

  window.PROJECTOR_RENDER = { create, isContent };
})();
