'use strict';

// Per-admin settings (admin_settings table) with defaults for missing keys.

const DEFAULTS = {
  // Decides "upcoming" vs "past" events.
  timezone: 'Europe/Oslo',
  // Chord notation for users without their own preference: 'letters' or 'solfege'.
  chord_notation_default: 'letters',
  // Colour theme for users without their own choice: 'dark', 'light' or 'auto'.
  theme_default: 'dark',
  // "Ziua și ora obișnuită a slujbei": the defaults of "+ Eveniment nou" (0 = Sunday).
  service_weekday: '0',
  service_time: '10:00',
  // The projector's corner clock: what a new event starts with, and the idle screen.
  clock_show: '1',
  clock_position: 'bottom-right',
  clock_scale: '1.8',
};

const { normalize: normalizeClock } = require('./clock');
const NOTATIONS = ['letters', 'solfege'];
const THEME_DEFAULTS = ['dark', 'light', 'auto'];

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch (err) {
    return false;
  }
}

function createAdminSettings(db) {
  const select = db.prepare('SELECT value FROM admin_settings WHERE admin_id = ? AND key = ?').pluck();

  function get(adminId, key) {
    const value = select.get(adminId, key);
    return value === undefined || value === null ? DEFAULTS[key] : value;
  }

  // The admin's timezone, falling back to the default if the stored one is not valid.
  function timezone(adminId) {
    const tz = get(adminId, 'timezone');
    return isValidTimezone(tz) ? tz : DEFAULTS.timezone;
  }

  const upsert = db.prepare(`INSERT INTO admin_settings (admin_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT (admin_id, key) DO UPDATE SET value = excluded.value`);

  function set(adminId, key, value) {
    upsert.run(adminId, key, value);
  }

  // The church default chord notation.
  function chordNotationDefault(adminId) {
    const value = get(adminId, 'chord_notation_default');
    return NOTATIONS.includes(value) ? value : DEFAULTS.chord_notation_default;
  }

  // The church default colour theme.
  function themeDefault(adminId) {
    const value = get(adminId, 'theme_default');
    return THEME_DEFAULTS.includes(value) ? value : DEFAULTS.theme_default;
  }

  // The usual service: { weekday: 0-6 (0 = Sunday), time: 'HH:MM' }.
  function service(adminId) {
    const weekday = Number(get(adminId, 'service_weekday'));
    const time = get(adminId, 'service_time');
    return {
      weekday: Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : Number(DEFAULTS.service_weekday),
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time || '') ? time : DEFAULTS.service_time,
    };
  }

  // The church default clock: { show, position, scale } (public/clock.js).
  function clock(adminId) {
    return normalizeClock({
      show: get(adminId, 'clock_show') === '1',
      position: get(adminId, 'clock_position'),
      scale: Number(get(adminId, 'clock_scale')),
    });
  }

  function setClock(adminId, values) {
    const next = normalizeClock({ ...clock(adminId), ...values });
    set(adminId, 'clock_show', next.show ? '1' : '0');
    set(adminId, 'clock_position', next.position);
    set(adminId, 'clock_scale', String(next.scale));
    return next;
  }

  return { get, set, timezone, chordNotationDefault, themeDefault, service, clock, setClock };
}

module.exports = { DEFAULTS, NOTATIONS, THEME_DEFAULTS, isValidTimezone, createAdminSettings };
