'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const configured = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[configured] || LEVELS.info;

function write(level, args) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(line, ...args);
}

module.exports = {
  debug: (...args) => write('debug', args),
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
};
