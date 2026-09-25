'use strict';

// Calendar dates as YYYY-MM-DD strings (an event's date is a local date, not an instant).

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidDate(value) {
  const m = DATE_RE.exec(String(value || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function isValidTime(value) {
  return TIME_RE.test(String(value || ''));
}

// Today's date in a timezone, e.g. todayIn('Europe/Oslo') -> '2026-09-25'.
function todayIn(timeZone, now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

module.exports = { isValidDate, isValidTime, todayIn };
