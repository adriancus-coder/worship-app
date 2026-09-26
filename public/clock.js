'use strict';

// The corner clock of the projector (as in Sanctuary Voice): its settings and the time text.
// Shared by the server (lib/clock.js: defaults, validation, frames) and the pages (the
// screen, the previews and the panels render and tick the clock themselves: no server
// traffic per minute).
//
//   clock settings: { show: boolean, position: one of POSITIONS, scale: SCALE_MIN..SCALE_MAX }
//   on a frame:     { show, position, scale, timeZone } (show is false while a video plays)

(function (root) {
  const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const SCALE_MIN = 0.7;
  const SCALE_MAX = 1.8;
  const SCALE_STEP = 0.1;
  const DEFAULTS = Object.freeze({ show: true, position: 'bottom-right', scale: 1.8 });

  // A scale kept inside the range, on the 0.1 grid; NaN -> the default.
  function clampScale(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULTS.scale;
    return Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, n)) * 10) / 10;
  }

  // Settings with every field valid (unknown values fall back to the defaults).
  function normalize(clock) {
    const c = clock && typeof clock === 'object' ? clock : {};
    return {
      show: c.show === undefined ? DEFAULTS.show : Boolean(c.show),
      position: POSITIONS.includes(c.position) ? c.position : DEFAULTS.position,
      scale: clampScale(c.scale === undefined ? DEFAULTS.scale : c.scale),
    };
  }

  // A change request ({ show?, position?, scale? }) -> the same with only valid, known fields,
  // or null when it holds nothing usable.
  function parsePatch(patch) {
    if (!patch || typeof patch !== 'object') return null;
    const out = {};
    if (typeof patch.show === 'boolean') out.show = patch.show;
    if (POSITIONS.includes(patch.position)) out.position = patch.position;
    if (typeof patch.scale === 'number' && Number.isFinite(patch.scale)) out.scale = clampScale(patch.scale);
    return Object.keys(out).length ? out : null;
  }

  const formatters = new Map();
  // 'HH:MM' (24 h) in a timezone; an unknown timezone falls back to the device's own.
  function formatTime(date, timeZone) {
    const key = timeZone || '';
    if (!formatters.has(key)) {
      let f;
      try {
        f = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      } catch (err) {
        f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      }
      formatters.set(key, f);
    }
    return formatters.get(key).format(date);
  }

  const CLOCK = { POSITIONS, SCALE_MIN, SCALE_MAX, SCALE_STEP, DEFAULTS, clampScale, normalize, parsePatch, formatTime };

  if (typeof module === 'object' && module.exports) module.exports = CLOCK;
  else root.CLOCK = CLOCK;
})(typeof window !== 'undefined' ? window : this);
