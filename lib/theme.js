'use strict';

// Colour theme: 'dark' | 'light' | 'auto' (follows the device). The effective theme of a
// signed-in user is their own choice, else the church default (admin setting
// theme_default). The server renders <html data-theme-pref data-theme> so the first paint
// is right (public/theme.js resolves 'auto' in <head> and follows device changes live).
// Signed-out pages (login, setup) use the wa_theme cookie, else 'auto'.

const { parseCookies } = require('./auth');
const { createAdminSettings } = require('./admin-settings');

const THEMES = ['dark', 'light', 'auto'];
const THEME_COOKIE = 'wa_theme';
const THEME_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
// The page background of each theme (= --background in public/styles.css; test-lib checks
// they match): the browser / status bar colour and the manifest colours. 'auto' starts dark.
const BROWSER_COLORS = { dark: '#141318', light: '#f7f5f1' };

const isTheme = (value) => THEMES.includes(value);

function setThemeCookie(res, theme, config) {
  res.cookie(THEME_COOKIE, theme, {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.IS_PRODUCTION,
    maxAge: THEME_COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

function themeCookie(req) {
  const value = parseCookies(req.headers.cookie)[THEME_COOKIE];
  return isTheme(value) ? value : null;
}

// The dark / light colour the server can promise for a preference ('auto' -> dark).
const browserColor = (pref) => BROWSER_COLORS[pref === 'light' ? 'light' : 'dark'];
// iOS home-screen status bar: light text over the page in the dark theme, the system's
// dark text on a light bar otherwise.
const statusBarStyle = (pref) => (pref === 'dark' ? 'black-translucent' : 'default');

// (req) -> the theme preference to render: the session's effective theme, else the cookie,
// else 'auto'.
function createThemeResolver({ db, auth }) {
  const settings = createAdminSettings(db);
  const effective = (user, adminId) => user.theme || settings.themeDefault(adminId);
  function themeOf(req) {
    const session = auth.getSession(req);
    if (session) return effective(session.user, session.admin.id);
    return themeCookie(req) || 'auto';
  }
  return { themeOf, effective };
}

module.exports = {
  THEMES, THEME_COOKIE, BROWSER_COLORS, isTheme, setThemeCookie, themeCookie, browserColor, statusBarStyle, createThemeResolver,
};
