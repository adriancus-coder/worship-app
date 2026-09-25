'use strict';

// Per-admin settings (admin_settings table) with defaults for missing keys.

const DEFAULTS = {
  // Decides "upcoming" vs "past" events.
  timezone: 'Europe/Oslo',
};

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

  return { get, timezone };
}

module.exports = { DEFAULTS, isValidTimezone, createAdminSettings };
