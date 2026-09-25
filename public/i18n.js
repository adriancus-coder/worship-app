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
        showToken: 'Arată',
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
        localeInvalid: 'Limbă necunoscută.',
        songNotFound: 'Cântarea nu a fost găsită.',
        songDuplicate: 'Există deja o cântare cu acest titlu.',
        songTitleInvalid: 'Titlul este obligatoriu (max. {max} de caractere).',
        songAuthorTooLong: 'Autorul poate avea cel mult {max} de caractere.',
        songKeyInvalid: 'Tonalitate necunoscută.',
        songSectionsCount: 'O cântare are între {min} și {max} secțiuni.',
        sectionTypeInvalid: 'Secțiunea {n}: tip necunoscut.',
        sectionLabelTooLong: 'Secțiunea {n}: eticheta poate avea cel mult {max} de caractere.',
        sectionContentInvalid: 'Secțiunea {n}: textul este obligatoriu (max. {max} de caractere).',
        sectionNoteTooLong: 'Secțiunea {n}: nota poate avea cel mult {max} de caractere.',
        resurseInvalidUrl: 'Link invalid. Sunt acceptate doar linkuri de cântări de pe https://www.resursecrestine.ro/cantece/…',
        resurseQueryTooShort: 'Scrie cel puțin 2 caractere.',
        resurseNotFound: 'Cântarea nu a fost găsită pe resursecrestine.ro.',
        resurseTimeout: 'resursecrestine.ro nu a răspuns în 10 secunde. Încearcă din nou mai târziu.',
        resurseUnreachable: 'resursecrestine.ro nu poate fi contactat acum. Încearcă din nou mai târziu.',
        resurseBadResponse: 'resursecrestine.ro a trimis un răspuns pe care nu îl putem citi.',
        resurseRateLimited: 'Prea multe căutări online. Așteaptă câteva minute.',
      },
      nav: {
        label: 'Navigare',
        home: 'Acasă',
        library: 'Bibliotecă',
      },
      library: {
        pageTitle: 'Bibliotecă — {appName}',
        heading: 'Bibliotecă',
        searchLabel: 'Caută după titlu sau versuri',
        searchHint: 'Pentru versuri scrie cel puțin două cuvinte la rând.',
        sortLabel: 'Ordine',
        sortAz: 'Titlu A–Z',
        sortZa: 'Titlu Z–A',
        sortRecent: 'Modificate recent',
        newSong: '+ Cântare nouă',
        loading: 'Se încarcă…',
        empty: 'Biblioteca e goală. Adaugă prima cântare.',
        emptyMember: 'Biblioteca e goală.',
        noResults: 'Nicio cântare găsită pentru „{q}”.',
        count: '{n} cântări',
        countOne: 'O cântare',
        matchedInLyrics: 'găsit în versuri',
        key: 'Ton {key}',
        tabsLabel: 'Surse de cântări',
        tabLocal: 'Biblioteca mea',
        tabOnline: 'Caută online',
        export: 'Exportă biblioteca',
      },
      online: {
        searchLabel: 'Caută pe resursecrestine.ro',
        searchHint: 'Caută după titlu, cel puțin 2 caractere.',
        search: 'Caută',
        searching: 'Se caută…',
        results: '{n} rezultate',
        resultOne: 'Un rezultat',
        noResults: 'Niciun rezultat pe resursecrestine.ro pentru „{q}”.',
        linkLabel: 'Importă din link',
        linkHint: 'Link de forma https://www.resursecrestine.ro/cantece/12345/…',
        preview: 'Previzualizare',
        previewSong: 'Previzualizare: {title}',
        loadingPreview: 'Se încarcă previzualizarea…',
        previewHeading: 'Previzualizare — încă nu e salvată',
        presentation: 'Ordine: {order}',
        import: 'Importă',
        importing: 'Se importă…',
        close: 'Închide',
        imported: 'Cântarea a fost importată.',
        openSong: 'Deschide cântarea',
        alreadyExists: 'Există deja o cântare cu acest titlu în bibliotecă.',
        openExisting: 'Deschide cântarea existentă',
      },
      song: {
        pageTitle: '{title} — {appName}',
        back: '← Bibliotecă',
        key: 'Ton: {key}',
        author: 'Autor: {author}',
        textOnly: 'Doar text',
        edit: 'Editează',
        notFound: 'Cântarea nu există sau a fost ștearsă.',
      },
      editor: {
        pageTitleNew: 'Cântare nouă — {appName}',
        pageTitleEdit: 'Editează: {title} — {appName}',
        headingNew: 'Cântare nouă',
        headingEdit: 'Editează cântarea',
        titleLabel: 'Titlu',
        authorLabel: 'Autor (opțional)',
        keyLabel: 'Tonalitate',
        keyNone: 'Fără',
        sectionsHeading: 'Secțiuni',
        typeLabel: 'Tip',
        customLabel: 'Etichetă (opțional)',
        contentLabel: 'Text și acorduri',
        contentHint: 'Acorduri în paranteze, ex. [G]Ne ridici, sau pe rândul de deasupra versului (se convertesc automat).',
        noteLabel: 'Notă pentru echipă (opțional)',
        moveUp: 'Mută „{label}” mai sus',
        moveDown: 'Mută „{label}” mai jos',
        removeSection: 'Șterge „{label}”',
        addSection: '+ Secțiune',
        save: 'Salvează',
        saving: 'Se salvează…',
        cancel: 'Renunță',
        titleRequired: 'Scrie un titlu.',
        openExisting: 'Deschide cântarea existentă',
        failed: 'Salvarea a eșuat.',
        dangerHeading: 'Zonă periculoasă',
        deleteSong: 'Șterge cântarea',
        deleteConfirm: 'Ștergi cântarea „{title}”?',
        deleteWarning: 'Cântarea și toate secțiunile ei vor fi șterse definitiv.',
        deleteConfirmButton: 'Da, șterge',
        deleteFailed: 'Ștergerea a eșuat.',
      },
      songs: {
        sectionNumbered: '{type} {n}',
        sectionTypes: {
          verse: 'Strofa',
          chorus: 'Refren',
          pre_chorus: 'Pre-refren',
          bridge: 'Punte',
          intro: 'Intro',
          outro: 'Final',
          tag: 'Tag',
          other: 'Secțiune',
        },
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
        showToken: 'Show',
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
        localeInvalid: 'Unknown language.',
        songNotFound: 'Song not found.',
        songDuplicate: 'A song with this title already exists.',
        songTitleInvalid: 'The title is required (max. {max} characters).',
        songAuthorTooLong: 'The author can be at most {max} characters.',
        songKeyInvalid: 'Unknown key.',
        songSectionsCount: 'A song has between {min} and {max} sections.',
        sectionTypeInvalid: 'Section {n}: unknown type.',
        sectionLabelTooLong: 'Section {n}: the label can be at most {max} characters.',
        sectionContentInvalid: 'Section {n}: the text is required (max. {max} characters).',
        sectionNoteTooLong: 'Section {n}: the note can be at most {max} characters.',
        resurseInvalidUrl: 'Invalid link. Only song links from https://www.resursecrestine.ro/cantece/… are accepted.',
        resurseQueryTooShort: 'Type at least 2 characters.',
        resurseNotFound: 'The song was not found on resursecrestine.ro.',
        resurseTimeout: 'resursecrestine.ro did not respond within 10 seconds. Try again later.',
        resurseUnreachable: 'resursecrestine.ro cannot be reached right now. Try again later.',
        resurseBadResponse: 'resursecrestine.ro sent a response we cannot read.',
        resurseRateLimited: 'Too many online searches. Wait a few minutes.',
      },
      nav: {
        label: 'Navigation',
        home: 'Home',
        library: 'Library',
      },
      library: {
        pageTitle: 'Library — {appName}',
        heading: 'Library',
        searchLabel: 'Search by title or lyrics',
        searchHint: 'For lyrics, type at least two words in a row.',
        sortLabel: 'Order',
        sortAz: 'Title A–Z',
        sortZa: 'Title Z–A',
        sortRecent: 'Recently changed',
        newSong: '+ New song',
        loading: 'Loading…',
        empty: 'The library is empty. Add the first song.',
        emptyMember: 'The library is empty.',
        noResults: 'No songs found for “{q}”.',
        count: '{n} songs',
        countOne: '1 song',
        matchedInLyrics: 'found in lyrics',
        key: 'Key {key}',
        tabsLabel: 'Song sources',
        tabLocal: 'My library',
        tabOnline: 'Search online',
        export: 'Export the library',
      },
      online: {
        searchLabel: 'Search resursecrestine.ro',
        searchHint: 'Search by title, at least 2 characters.',
        search: 'Search',
        searching: 'Searching…',
        results: '{n} results',
        resultOne: '1 result',
        noResults: 'No results on resursecrestine.ro for “{q}”.',
        linkLabel: 'Import from a link',
        linkHint: 'A link like https://www.resursecrestine.ro/cantece/12345/…',
        preview: 'Preview',
        previewSong: 'Preview: {title}',
        loadingPreview: 'Loading the preview…',
        previewHeading: 'Preview — not saved yet',
        presentation: 'Order: {order}',
        import: 'Import',
        importing: 'Importing…',
        close: 'Close',
        imported: 'The song was imported.',
        openSong: 'Open the song',
        alreadyExists: 'A song with this title is already in the library.',
        openExisting: 'Open the existing song',
      },
      song: {
        pageTitle: '{title} — {appName}',
        back: '← Library',
        key: 'Key: {key}',
        author: 'Author: {author}',
        textOnly: 'Lyrics only',
        edit: 'Edit',
        notFound: 'This song does not exist or was deleted.',
      },
      editor: {
        pageTitleNew: 'New song — {appName}',
        pageTitleEdit: 'Edit: {title} — {appName}',
        headingNew: 'New song',
        headingEdit: 'Edit song',
        titleLabel: 'Title',
        authorLabel: 'Author (optional)',
        keyLabel: 'Key',
        keyNone: 'None',
        sectionsHeading: 'Sections',
        typeLabel: 'Type',
        customLabel: 'Label (optional)',
        contentLabel: 'Lyrics and chords',
        contentHint: 'Chords in brackets, e.g. [G]Ne ridici, or on the line above the lyrics (converted automatically).',
        noteLabel: 'Note for the team (optional)',
        moveUp: 'Move “{label}” up',
        moveDown: 'Move “{label}” down',
        removeSection: 'Delete “{label}”',
        addSection: '+ Section',
        save: 'Save',
        saving: 'Saving…',
        cancel: 'Cancel',
        titleRequired: 'Enter a title.',
        openExisting: 'Open the existing song',
        failed: 'Saving failed.',
        dangerHeading: 'Danger zone',
        deleteSong: 'Delete song',
        deleteConfirm: 'Delete the song “{title}”?',
        deleteWarning: 'The song and all its sections will be deleted permanently.',
        deleteConfirmButton: 'Yes, delete',
        deleteFailed: 'Deleting failed.',
      },
      songs: {
        sectionNumbered: '{type} {n}',
        sectionTypes: {
          verse: 'Verse',
          chorus: 'Chorus',
          pre_chorus: 'Pre-chorus',
          bridge: 'Bridge',
          intro: 'Intro',
          outro: 'Outro',
          tag: 'Tag',
          other: 'Section',
        },
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

  // Browser: the page language comes from <html lang> (set by the server),
  // {appName} from <html data-app-name>.
  const html = document.documentElement;
  const LANG_COOKIE = 'wa_lang';
  const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
  let current = LANGS.includes(html.lang) ? html.lang : DEFAULT_LANG;

  function apply(scope) {
    const base = { appName: html.dataset.appName || '' };
    html.lang = current;
    for (const el of (scope || document).querySelectorAll('[data-i18n]')) {
      const vars = Object.assign({}, base, el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : null);
      el.textContent = t(el.dataset.i18n, vars, current);
    }
    for (const el of (scope || document).querySelectorAll('[data-i18n-aria-label]')) {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel, base, current));
    }
    for (const button of document.querySelectorAll('.lang-switch [data-lang]')) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === current));
    }
  }

  // Saves the choice in the wa_lang cookie and re-applies all texts in place.
  function setLang(lang) {
    if (!LANGS.includes(lang)) return;
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
    if (lang === current) return;
    current = lang;
    apply();
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang } }));
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.lang-switch [data-lang]');
    if (button) setLang(button.dataset.lang);
  });

  root.I18N = {
    DEFAULT_LANG,
    LANGS,
    STRINGS,
    get lang() { return current; },
    t: (key, vars, lang) => t(key, vars, lang || current),
    apply,
    setLang,
  };
  apply();
})(typeof window !== 'undefined' ? window : this);
