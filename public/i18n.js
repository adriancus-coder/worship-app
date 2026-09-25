'use strict';

// UI strings. Shared by the browser pages and the server (lib/i18n.js).
// Add a language by adding a sibling of `ro` with the same keys.

(function (root) {
  const DEFAULT_LANG = 'ro';

  const STRINGS = {
    ro: {
      common: {
        networkError: 'Serverul nu răspunde. Încearcă din nou.',
      },
      setup: {
        pageTitle: 'Configurare inițială — {appName}',
        heading: 'Configurare inițială',
        intro: 'Creează contul bisericii sau al echipei și contul tău de proprietar.',
        tokenLabel: 'Cod de configurare',
        tokenHint: 'Valoarea SETUP_TOKEN din configurația serverului.',
        adminLegend: 'Biserica / echipa',
        adminNameLabel: 'Nume',
        ownerLegend: 'Contul tău (proprietar)',
        ownerNameLabel: 'Nume',
        ownerEmailLabel: 'Email',
        ownerPasswordLabel: 'Parolă',
        passwordHint: 'Cel puțin {min} caractere.',
        submit: 'Creează contul',
        done: 'Configurarea s-a încheiat. Te poți autentifica acum.',
        goToLogin: 'Mergi la autentificare',
        failed: 'Configurarea a eșuat.',
      },
      login: {
        pageTitle: 'Autentificare — {appName}',
        heading: 'Autentificare',
        intro: 'Intră în contul tău.',
        emailLabel: 'Email',
        passwordLabel: 'Parolă',
        remember: 'Ține-mă minte',
        submit: 'Intră',
        missingFields: 'Completează emailul și parola.',
        failed: 'Autentificarea a eșuat.',
      },
      app: {
        pageTitle: '{appName}',
        heading: '{appName}',
        loading: 'Se încarcă…',
        signedInAs: 'Conectat ca {name} ({role}) — {adminName}',
        logout: 'Deconectare',
        loadFailed: 'Serverul nu răspunde. Reîncarcă pagina.',
      },
      errors: {
        badRequest: 'Cerere invalidă.',
        internal: 'Eroare internă.',
        notFound: 'Nu a fost găsit.',
        unauthenticated: 'Neautentificat.',
        forbidden: 'Acces interzis.',
        setupDisabled: 'Configurarea inițială este dezactivată.',
        setupBadToken: 'Cod de configurare invalid.',
        setupDone: 'Aplicația este deja configurată.',
        adminNameInvalid: 'Numele bisericii / echipei este obligatoriu (max. {max} de caractere).',
        ownerNameInvalid: 'Numele tău este obligatoriu (max. {max} de caractere).',
        emailInvalid: 'Adresa de email nu este validă.',
        passwordTooShort: 'Parola trebuie să aibă cel puțin {min} caractere.',
        invalidLogin: 'Email sau parolă incorecte.',
        tooManyAttempts: 'Prea multe încercări eșuate. Încearcă din nou mai târziu.',
      },
      roles: {
        owner: 'proprietar',
        leader: 'lider worship',
        operator: 'operator',
        member: 'membru',
      },
    },
    en: {
      common: {
        networkError: 'The server is not responding. Please try again.',
      },
      setup: {
        pageTitle: 'First-time setup — {appName}',
        heading: 'First-time setup',
        intro: 'Create the account for your church or team, and your owner account.',
        tokenLabel: 'Setup code',
        tokenHint: 'The SETUP_TOKEN value from the server configuration.',
        adminLegend: 'Church / team',
        adminNameLabel: 'Name',
        ownerLegend: 'Your account (owner)',
        ownerNameLabel: 'Name',
        ownerEmailLabel: 'Email',
        ownerPasswordLabel: 'Password',
        passwordHint: 'At least {min} characters.',
        submit: 'Create account',
        done: 'Setup is complete. You can sign in now.',
        goToLogin: 'Go to sign in',
        failed: 'Setup failed.',
      },
      login: {
        pageTitle: 'Sign in — {appName}',
        heading: 'Sign in',
        intro: 'Sign in to your account.',
        emailLabel: 'Email',
        passwordLabel: 'Password',
        remember: 'Remember me',
        submit: 'Sign in',
        missingFields: 'Enter your email and password.',
        failed: 'Sign-in failed.',
      },
      app: {
        pageTitle: '{appName}',
        heading: '{appName}',
        loading: 'Loading…',
        signedInAs: 'Signed in as {name} ({role}) — {adminName}',
        logout: 'Sign out',
        loadFailed: 'The server is not responding. Reload the page.',
      },
      errors: {
        badRequest: 'Invalid request.',
        internal: 'Internal error.',
        notFound: 'Not found.',
        unauthenticated: 'Not signed in.',
        forbidden: 'Access denied.',
        setupDisabled: 'First-time setup is disabled.',
        setupBadToken: 'Invalid setup code.',
        setupDone: 'The app is already set up.',
        adminNameInvalid: 'The church / team name is required (max. {max} characters).',
        ownerNameInvalid: 'Your name is required (max. {max} characters).',
        emailInvalid: 'The email address is not valid.',
        passwordTooShort: 'The password must be at least {min} characters.',
        invalidLogin: 'Incorrect email or password.',
        tooManyAttempts: 'Too many failed attempts. Please try again later.',
      },
      roles: {
        owner: 'owner',
        leader: 'worship leader',
        operator: 'operator',
        member: 'member',
      },
    },
  };

  const LANGS = Object.keys(STRINGS);

  function lookup(lang, key) {
    let node = STRINGS[lang];
    for (const part of key.split('.')) {
      if (node == null) return undefined;
      node = node[part];
    }
    return typeof node === 'string' ? node : undefined;
  }

  // t('login.heading'), t('errors.passwordTooShort', { min: 10 })
  function t(key, vars, lang) {
    const text = lookup(lang || DEFAULT_LANG, key) ?? lookup(DEFAULT_LANG, key) ?? key;
    return text.replace(/\{(\w+)\}/g, (match, name) => (vars && name in vars ? String(vars[name]) : match));
  }

  const I18N = { DEFAULT_LANG, LANGS, STRINGS, t };

  if (typeof module === 'object' && module.exports) {
    module.exports = I18N;
    return;
  }

  // Browser: fill every [data-i18n] element; {appName} comes from <html data-app-name>.
  I18N.apply = function apply(scope) {
    const html = document.documentElement;
    const base = { appName: html.dataset.appName || '' };
    html.lang = DEFAULT_LANG;
    for (const el of (scope || document).querySelectorAll('[data-i18n]')) {
      const vars = Object.assign({}, base, el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : null);
      el.textContent = t(el.dataset.i18n, vars);
    }
  };
  root.I18N = I18N;
  I18N.apply();
})(typeof window !== 'undefined' ? window : this);
