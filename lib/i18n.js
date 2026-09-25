'use strict';

// Server-side access to the shared UI strings in public/i18n.js,
// plus per-request language resolution.

const I18N = require('../public/i18n.js');
const { parseCookies } = require('./auth');

const LANG_COOKIE = 'wa_lang';

function isLang(value) {
  return I18N.LANGS.includes(value);
}

// First supported language in Accept-Language, by q value then order; null if none.
function fromAcceptLanguage(header) {
  const ranges = String(header || '').split(',').map((part, index) => {
    const [tag, ...params] = part.trim().split(';');
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    return { lang: tag.trim().toLowerCase().split('-')[0], q, index };
  });
  const match = ranges
    .filter((r) => r.lang && Number.isFinite(r.q) && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .find((r) => isLang(r.lang));
  return match ? match.lang : null;
}

// Cookie wa_lang -> Accept-Language -> default.
function resolveLang(req) {
  const cookie = parseCookies(req.headers.cookie)[LANG_COOKIE];
  if (isLang(cookie)) return cookie;
  return fromAcceptLanguage(req.headers['accept-language']) || I18N.DEFAULT_LANG;
}

// Sets req.lang and req.t for every request.
function createI18nMiddleware() {
  return (req, res, next) => {
    req.lang = resolveLang(req);
    req.t = (key, vars) => I18N.t(key, vars, req.lang);
    next();
  };
}

module.exports = {
  ...I18N,
  LANG_COOKIE,
  isLang,
  resolveLang,
  createI18nMiddleware,
};
