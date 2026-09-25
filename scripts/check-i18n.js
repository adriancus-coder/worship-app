'use strict';

// Fails if the languages in public/i18n.js differ in keys or in {placeholders}.

const path = require('path');
const { STRINGS } = require(path.join(__dirname, '..', 'public', 'i18n.js'));

function flatten(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value, full, out);
    else out.set(full, value);
  }
  return out;
}

function placeholders(text) {
  return [...new Set(String(text).match(/\{\w+\}/g) || [])].sort().join(' ');
}

const langs = Object.keys(STRINGS);
const flat = Object.fromEntries(langs.map((lang) => [lang, flatten(STRINGS[lang], '', new Map())]));
const allKeys = new Set(langs.flatMap((lang) => [...flat[lang].keys()]));
const problems = [];

for (const key of [...allKeys].sort()) {
  const missing = langs.filter((lang) => !flat[lang].has(key));
  if (missing.length > 0) {
    problems.push(`${key}: missing in ${missing.join(', ')}`);
    continue;
  }
  for (const lang of langs) {
    if (typeof flat[lang].get(key) !== 'string') problems.push(`${key}: not a string in ${lang}`);
  }
  const expected = placeholders(flat[langs[0]].get(key));
  for (const lang of langs.slice(1)) {
    const actual = placeholders(flat[lang].get(key));
    if (actual !== expected) {
      problems.push(`${key}: placeholders differ (${langs[0]}: "${expected}", ${lang}: "${actual}")`);
    }
  }
}

if (problems.length > 0) {
  console.error(`check-i18n: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-i18n: ${allKeys.size} keys OK in ${langs.join(', ')}`);
