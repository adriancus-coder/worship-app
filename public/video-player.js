'use strict';

// Video on the projector screen. Driven by the frames: a prepared video (frame.video) is
// preloaded without being shown; it is shown and played only on a 'video' frame.
//   upload / file   <video> full screen, object-fit contain (black bars)
//   youtube         borderless iframe (youtube-nocookie.com), controlled with postMessage
//   vimeo           borderless iframe (player.vimeo.com), controlled with postMessage
//   local           a file picked on this PC ("Alege fișierul video"); it never leaves the PC
// Playback is reported with onStatus({ state, position, duration, error, seq }) at most once
// a second (and on every state change). No vendor script is loaded.

(function () {
  const REPORT_MS = 1000;

  function create(layer, { onStatus = () => {}, onLocalChosen = () => {}, t = (k) => k } = {}) {
    let current = null; // { key, type, el, media, seq }
    let wanted = null; // the last frame.video
    let visible = false;
    let blocked = false; // autoplay with sound refused: waits for a click on this page
    let lastReport = 0;
    let lastState = null;
    let localUrl = null;
    let localName = null;
    const info = { position: 0, duration: null, state: 'loading' };

    const picker = document.createElement('div');
    picker.className = 'local-picker';
    picker.hidden = true;
    const pickButton = document.createElement('button');
    pickButton.type = 'button';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.hidden = true;
    picker.append(pickButton, input);
    document.body.append(picker);
    pickButton.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      if (localUrl) URL.revokeObjectURL(localUrl);
      localUrl = URL.createObjectURL(file);
      localName = file.name;
      picker.hidden = true;
      onLocalChosen(file.name);
      if (wanted) apply(wanted, visible);
    });

    function report(state, extra = {}, force = false) {
      const now = Date.now();
      if (!force && state === lastState && now - lastReport < REPORT_MS) return;
      lastReport = now;
      lastState = state;
      info.state = state;
      onStatus({ state, position: info.position, duration: info.duration, seq: current ? current.seq : null, ...extra });
    }

    function mediaKey(media) {
      if (!media) return null;
      if (media.type === 'local') return `local:${media.name || ''}`;
      return media.type === 'youtube' || media.type === 'vimeo' ? `${media.type}:${media.id}` : `${media.type}:${media.src}`;
    }

    // --- element per media type -------------------------------------------------------

    function videoElement(src) {
      const video = document.createElement('video');
      video.className = 'projector-video';
      video.preload = 'auto';
      video.playsInline = true;
      video.src = src;
      video.addEventListener('timeupdate', () => {
        info.position = video.currentTime;
        info.duration = Number.isFinite(video.duration) ? video.duration : null;
        if (!video.paused) report('playing');
      });
      video.addEventListener('loadedmetadata', () => {
        info.duration = Number.isFinite(video.duration) ? video.duration : null;
        report(video.paused ? 'ready' : 'playing', {}, true);
      });
      video.addEventListener('pause', () => { if (!video.ended) report('paused', {}, true); });
      video.addEventListener('playing', () => report('playing', {}, true));
      video.addEventListener('waiting', () => report('waiting', {}, true));
      video.addEventListener('ended', () => report('ended', {}, true));
      video.addEventListener('error', () => report('error', { error: 'load' }, true));
      return {
        el: video,
        play: () => video.play().then(() => { blocked = false; }).catch((err) => {
          if (err && err.name === 'NotAllowedError') {
            blocked = true;
            layer.classList.remove('visible'); // nothing on the projector rather than a still frame
            report('error', { error: 'autoplay' }, true);
          } else if (err && err.name !== 'AbortError') {
            report('error', { error: 'load' }, true);
          }
        }),
        pause: () => video.pause(),
        seek: (s) => { try { video.currentTime = s; } catch (err) { /* not loaded yet */ } },
        volume: (v) => { video.volume = v; video.muted = false; },
        destroy: () => { video.pause(); video.removeAttribute('src'); video.load(); },
      };
    }

    function iframeElement(type, id) {
      const frame = document.createElement('iframe');
      frame.className = 'projector-video';
      frame.allow = 'autoplay; encrypted-media; fullscreen';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.setAttribute('frameborder', '0');
      const origin = window.location.origin;
      frame.src = type === 'youtube'
        ? `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&origin=${encodeURIComponent(origin)}`
        : `https://player.vimeo.com/video/${id}?controls=0&title=0&byline=0&portrait=0&dnt=1&autoplay=0`;
      const targetOrigin = type === 'youtube' ? 'https://www.youtube-nocookie.com' : 'https://player.vimeo.com';
      const post = (msg) => { try { frame.contentWindow.postMessage(JSON.stringify(msg), targetOrigin); } catch (err) { /* not loaded */ } };
      const command = type === 'youtube'
        ? (func, args = []) => post({ event: 'command', func, args })
        : (method, value) => post(value === undefined ? { method } : { method, value });
      function onMessage(event) {
        if (event.origin !== targetOrigin || event.source !== frame.contentWindow) return;
        let data = event.data;
        try { if (typeof data === 'string') data = JSON.parse(data); } catch (err) { return; }
        if (type === 'youtube' && data && data.event === 'infoDelivery' && data.info) {
          if (typeof data.info.currentTime === 'number') info.position = data.info.currentTime;
          if (typeof data.info.duration === 'number' && data.info.duration > 0) info.duration = data.info.duration;
          const s = data.info.playerState;
          if (s === 0) report('ended', {}, true);
          else if (s === 1) report('playing', {}, lastState !== 'playing');
          else if (s === 2) report('paused', {}, true);
          else if (s === 3) report('waiting');
        } else if (type === 'youtube' && data && data.event === 'onReady') {
          report('ready', {}, true);
        } else if (type === 'vimeo' && data) {
          if (data.event === 'ready') {
            ['timeupdate', 'ended', 'play', 'pause'].forEach((name) => command('addEventListener', name));
            report('ready', {}, true);
          } else if (data.event === 'timeupdate' && data.data) {
            info.position = data.data.seconds;
            info.duration = data.data.duration;
            report('playing');
          } else if (data.event === 'play') report('playing', {}, true);
          else if (data.event === 'pause') report('paused', {}, true);
          else if (data.event === 'ended') report('ended', {}, true);
        }
      }
      window.addEventListener('message', onMessage);
      frame.addEventListener('load', () => {
        if (type === 'youtube') post({ event: 'listening', id: 1, channel: 'widget' });
        else command('addEventListener', 'ready');
      });
      return {
        el: frame,
        play: () => (type === 'youtube' ? command('playVideo') : command('play')),
        pause: () => (type === 'youtube' ? command('pauseVideo') : command('pause')),
        seek: (s) => (type === 'youtube' ? command('seekTo', [s, true]) : command('setCurrentTime', s)),
        volume: (v) => (type === 'youtube' ? command('setVolume', [Math.round(v * 100)]) : command('setVolume', v)),
        destroy: () => window.removeEventListener('message', onMessage),
      };
    }

    function load(media, seq) {
      unload();
      let player;
      if (media.type === 'youtube' || media.type === 'vimeo') player = iframeElement(media.type, media.id);
      else if (media.type === 'local') player = localUrl ? videoElement(localUrl) : null;
      else player = videoElement(media.src);
      if (!player) return;
      info.position = 0;
      info.duration = null;
      current = { key: mediaKey(media), type: media.type, media, seq, ...player };
      layer.replaceChildren(player.el);
      report('loading', {}, true);
    }

    function unload() {
      if (current) current.destroy();
      current = null;
      layer.replaceChildren();
      layer.classList.remove('visible');
    }

    // --- following the frames -----------------------------------------------------------

    function showPicker(show) {
      pickButton.textContent = t('screen.localPick');
      picker.hidden = !show;
    }

    // video: frame.video (or null); show: the frame is a 'video' frame.
    function apply(video, show) {
      wanted = video;
      visible = show;
      if (!video) {
        unload();
        showPicker(false);
        return;
      }
      const media = video.media;
      if (media.type === 'local') {
        // The file is picked here, on the projector PC (a click is required by the browser).
        const needsPick = !localUrl || (media.name && media.name !== localName);
        showPicker(needsPick);
        if (needsPick) {
          unload();
          return;
        }
      } else {
        showPicker(false);
      }
      const key = mediaKey(media.type === 'local' ? { type: 'local', name: localName } : media);
      if (!current || current.key !== key) load(media.type === 'local' ? { type: 'local', name: localName } : media, video.seq);
      if (!current) return;
      if (current.seq !== video.seq) {
        current.seq = video.seq;
        current.seek(video.position || 0);
      }
      current.volume(video.volume ?? 1);
      if (show && video.state === 'playing') {
        if (!blocked) layer.classList.add('visible');
        current.play();
      } else if (show && video.state === 'paused') {
        layer.classList.add('visible');
        current.pause();
      } else {
        layer.classList.remove('visible');
        current.pause();
      }
    }

    // A click on the projector page allows sound: retry a blocked video.
    document.addEventListener('pointerdown', () => {
      if (!blocked) return;
      blocked = false;
      if (wanted && visible) apply(wanted, visible);
    });

    return { apply, get blocked() { return blocked; } };
  }

  window.VIDEO_PLAYER = { create };
})();
