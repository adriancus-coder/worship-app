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

// The current local time in a timezone, 'HH:MM'.
function nowTimeIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

// The date of the next service: the next `weekday` (0 = Sunday) on or after today, and
// today itself only while the service can still be ahead or under way (before its time +
// 2 h, e.g. before 12:00 for a 10:00 service); later that day it is the week after.
function nextServiceDate(today, nowTime, weekday, serviceTime) {
  const d = new Date(`${today}T12:00:00Z`);
  const ahead = (weekday - d.getUTCDay() + 7) % 7;
  const [h, m] = serviceTime.split(':').map(Number);
  const cutoff = `${String(Math.min(23, h + 2)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  d.setUTCDate(d.getUTCDate() + (ahead === 0 && nowTime >= cutoff ? 7 : ahead));
  return d.toISOString().slice(0, 10);
}

module.exports = { isValidDate, isValidTime, todayIn, nowTimeIn, nextServiceDate };
