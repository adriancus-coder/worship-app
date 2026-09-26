'use strict';

// One song search for the library, the event editor and the operator console: ONE field.
// Typing filters the library (debounced /api/songs?q=) under "Din bibliotecă"; when online
// search is allowed, Enter or "Caută și pe resurse" also searches resursecrestine.ro and
// shows "De pe resurse" (never on every keystroke; the section goes as soon as the query
// changes). A pasted resursecrestine.ro link opens its preview. The server does all
// network access; everything here runs in the background of the page (a spinner and any
// error stay inside this search).
//
//   const search = SONG_SEARCH.create(root, options)
//     mode: 'library'  the /library page: binds to its markup (ids without a prefix); a
//                      library result opens the song, an online one offers Previzualizare
//                      and Importă; the query and sort live in the URL.
//           'pick'     builds its own markup (ids prefixed with `prefix`); each result gets
//                      the caller's actions:
//       localActions(song)  -> [{ label, icon, primary, run(song) }]
//       onlineActions(item) -> [{ label, icon, primary, run(songId, item) }] — the song is
//                      imported first (or, when it is already in the library, the existing
//                      one is used), then run() gets its id.
//       emptyQuery: 'all' (list the library) | 'none'; limit: max library results;
//       withHistory: ask for "last sung"; songHint(song) -> extra text under a result.
//     search.setOnline(allowed)  // resursecrestine.ro for this user
//     search.setMe(me)           // library mode: texts for editors vs the team
//     search.reload(), search.reset(), search.focus(), search.message(text, tone)

(function () {
  const { api, el, canEdit } = window.PAGE;
  const { t } = window.I18N;
  const SEARCH_DELAY_MS = 250;
  const isLink = (text) => /^https?:\/\//i.test(text) || /(^|\.)resursecrestine\.ro\b/i.test(text);
  const failText = (res) => (res && res.body && res.body.error) || t('common.networkError');

  // The pick mode's markup: the library's structure with prefixed ids (no sort, no URL).
  function build(root, p, headingLevel) {
    const h = `h${headingLevel}`;
    root.innerHTML = `
      <form id="${p}search-form" class="search-form" role="search" novalidate>
        <label for="${p}q" class="sr-only" data-i18n="library.searchLabel"></label>
        <div class="input-row search-row">
          <input type="search" id="${p}q" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
            maxlength="200" aria-describedby="${p}q-hint" aria-controls="${p}songs">
          <button type="submit" class="secondary" id="${p}online-search" hidden data-icon="search" data-i18n="online.searchBoth"></button>
        </div>
        <span class="hint" id="${p}q-hint"></span>
      </form>
      <div class="ss-results" id="${p}results">
      <section class="results-section pane-section" aria-labelledby="${p}local-heading">
        <div class="results-head pane-heading">
          <${h} id="${p}local-heading" class="results-heading"><span data-i18n="library.localHeading"></span> <span id="${p}local-count" class="results-count"></span></${h}>
        </div>
        <p id="${p}status" class="muted pane-state" role="status" aria-live="polite"></p>
        <ul id="${p}songs" class="song-list pick-results"></ul>
      </section>
      <section class="results-section pane-section" id="${p}online-section" aria-labelledby="${p}online-heading" hidden>
        <div class="results-head pane-heading">
          <${h} id="${p}online-heading" class="results-heading"><span data-i18n="library.onlineHeading"></span> <span id="${p}online-count" class="results-count"></span></${h}>
        </div>
        <p id="${p}online-status" class="muted online-status" role="status" aria-live="polite"></p>
        <p id="${p}online-error" class="message error" role="alert"></p>
        <ul id="${p}online-results" class="song-list"></ul>
      </section>
      </div>
      <dialog id="${p}online-preview" class="preview-dialog" aria-labelledby="${p}preview-title">
        <div class="preview-dialog-head">
          <div class="preview-dialog-title">
            <p class="preview-kicker" data-i18n="online.previewHeading"></p>
            <h2 id="${p}preview-title" tabindex="-1"></h2>
            <p id="${p}preview-meta" class="muted"></p>
          </div>
          <button type="button" class="shell-close preview-close-x" id="${p}preview-close-x" data-i18n-aria-label="online.close">✕</button>
        </div>
        <div class="preview-dialog-body">
          <div class="preview-tools"></div>
          <div id="${p}preview-sections" class="preview-sections"></div>
        </div>
        <div class="preview-dialog-foot">
          <p id="${p}preview-message" class="message" role="alert"></p>
          <div class="form-actions">
            <span id="${p}preview-actions" class="preview-actions"></span>
            <button type="button" id="${p}preview-close" class="secondary" data-i18n="online.close"></button>
          </div>
        </div>
      </dialog>`;
    window.I18N.apply(root);
    root.querySelector('.preview-tools').append(window.NOTATION.createSwitch());
    // The results scroll in their own pane; the search field stays (public/list-pane.js).
    if (window.LIST_PANE) window.LIST_PANE.attach(root.querySelector('.ss-results'), () => window.I18N.t('library.resultsPane'));
  }

  function create(root, options = {}) {
    const mode = options.mode === 'pick' ? 'pick' : 'library';
    const p = mode === 'pick' ? (options.prefix || 'ss-') : '';
    if (mode === 'pick') build(root, p, options.headingLevel || 3);
    const $ = (id) => document.getElementById(p + id);
    const input = $('q');
    const sort = mode === 'library' ? $('sort') : null;
    const status = $('status');
    const list = $('songs');
    const form = $('search-form');
    const onlineButton = $('online-search');
    const section = $('online-section');
    const onlineStatus = $('online-status');
    const errorBox = $('online-error');
    const resultsList = $('online-results');
    const dialog = $('online-preview');
    const previewTitle = $('preview-title');
    const previewMeta = $('preview-meta');
    const previewSections = $('preview-sections');
    const previewMessage = $('preview-message');
    const importButton = mode === 'library' ? $('preview-import') : null;
    const previewActions = mode === 'pick' ? $('preview-actions') : null;

    let me = null;
    // --- the library part ---------------------------------------------------------------

    const local = { songs: null, lastQuery: '', request: 0, timer: null, busy: null, message: null };

    // The status line's look (keeps other classes, e.g. pane-state in a list pane).
    function tone(classes) {
      status.classList.remove('muted', 'message', 'error', 'success');
      status.classList.add(...classes.split(' '));
    }

    function setStatus(text) {
      status.removeAttribute('data-i18n');
      status.textContent = text || '';
      status.hidden = !text;
    }

    function songMeta(song) {
      return [song.song_key ? t('library.key', { key: window.NOTATION.chord(song.song_key) }) : null, song.author].filter(Boolean).join(' · ');
    }

    function actionButton(action, index, busyKey, disabled, onRun) {
      const busy = local.busy === busyKey || online.busy === busyKey;
      return el('button', {
        type: 'button', class: action.primary ? null : 'secondary', 'data-icon': action.icon || null,
        disabled: disabled || busy, 'aria-label': action.ariaLabel || null, onclick: onRun,
      }, busy ? el('span', { class: 'spinner', 'aria-hidden': 'true' }) : null, action.label);
    }

    function localRow(song) {
      if (mode === 'library') {
        return el('li', null,
          el('a', { class: 'song-link', href: `/songs/${song.id}` },
            el('span', { class: 'song-title', text: song.title }),
            songMeta(song) ? el('span', { class: 'song-meta', text: songMeta(song) }) : null,
            song.matchedIn === 'lyrics' ? el('span', { class: 'song-hint', text: t('library.matchedInLyrics') }) : null));
      }
      const hint = options.songHint ? options.songHint(song) : (song.matchedIn === 'lyrics' ? t('library.matchedInLyrics') : '');
      const actions = options.localActions ? options.localActions(song) : [];
      return el('li', { class: 'result-row' },
        el('div', { class: 'result-text' },
          el('span', { class: 'song-title', text: song.title }),
          songMeta(song) ? el('span', { class: 'song-meta', text: songMeta(song) }) : null,
          hint ? el('span', { class: 'song-hint', text: hint }) : null),
        el('div', { class: 'result-actions' }, actions.map((action, i) => actionButton(action, i, `local:${song.id}:${i}`, options.disabled && options.disabled(),
          () => runLocal(song, action, i)))));
    }

    async function runLocal(song, action, i) {
      local.busy = `local:${song.id}:${i}`;
      local.message = null;
      renderLocal();
      try {
        const out = await action.run(song);
        if (out && out.error) local.message = { text: out.error, tone: 'error' };
        else if (out && out.done) local.message = { text: out.done, tone: 'success' };
      } catch (err) {
        local.message = { text: t('common.networkError'), tone: 'error' };
      } finally {
        local.busy = null;
        renderLocal();
      }
    }

    function renderChrome() {
      input.placeholder = t('library.searchPlaceholder');
      $('q-hint').textContent = t(online.allowed ? 'library.searchHintOnline' : 'library.searchHint');
    }

    function renderLocal() {
      renderChrome();
      if (!local.songs) return;
      list.replaceChildren(...local.songs.map(localRow));
      $('local-count').textContent = local.songs.length ? `(${local.songs.length})` : '';
      if (local.message) {
        setStatus(local.message.text);
        tone(`message ${local.message.tone}`);
        return;
      }
      tone('muted');
      if (local.songs.length) setStatus('');
      else if (local.lastQuery) setStatus(t('library.noResults', { q: local.lastQuery }));
      else if (mode === 'pick') setStatus(options.emptyQuery === 'none' ? '' : t('library.emptyMember'));
      else setStatus(t(canEdit(me) ? 'library.empty' : 'library.emptyMember'));
    }

    async function load() {
      const query = input.value.trim();
      const id = ++local.request;
      if (mode === 'library') {
        const qs = new URLSearchParams();
        if (query) qs.set('q', query);
        if (sort.value !== 'az') qs.set('sort', sort.value);
        const search = qs.toString();
        window.history.replaceState(null, '', search ? `?${search}` : window.location.pathname);
      } else if (!query && options.emptyQuery === 'none') {
        local.songs = [];
        local.lastQuery = '';
        renderLocal();
        return;
      }
      try {
        const qs = { q: query, sort: sort ? sort.value : 'az' };
        if (options.withHistory) qs.withHistory = '1';
        const { ok, body } = await api(`/api/songs?${new URLSearchParams(qs)}`);
        if (id !== local.request) return; // a newer search is on its way
        if (!ok) {
          setStatus(body.error || t('common.networkError'));
          return;
        }
        local.songs = options.limit ? body.songs.slice(0, options.limit) : body.songs;
        local.lastQuery = query;
        if (options.onLoaded) options.onLoaded(body);
        renderLocal();
      } catch (err) {
        if (id === local.request) setStatus(t('common.networkError'));
      }
    }

    // --- resursecrestine.ro -------------------------------------------------------------

    // Everything shown is rebuilt from this state, so a language switch re-renders it.
    const online = {
      allowed: false,
      shown: false, // the "De pe resurse" section
      query: '', // what the results (or the link preview) belong to
      results: null,
      rows: new Map(), // result id -> { kind: 'imported' | 'exists', songId } | { kind: 'error', text } | { kind: 'done', text }
      status: null, // { key, vars, spin }
      error: null, // server text
      preview: null, // { source, resultId, song, existingId, invalid }
      outcome: null, // { kind: 'imported' | 'exists' | 'error' | 'done', id?, text? }
      busy: false, // 'search' | 'preview' | 'import' | 'row:<id>' | 'online:<id>:<i>'
    };

    function rowActions(item) {
      const row = online.rows.get(item.id);
      const busy = Boolean(online.busy);
      if (mode === 'pick') {
        const actions = options.onlineActions ? options.onlineActions(item) : [];
        return [
          el('button', {
            type: 'button', class: 'secondary', disabled: busy, 'data-icon': 'follow',
            'aria-label': t('online.previewSong', { title: item.title }),
            onclick: () => openPreview({ id: item.id }, item.id),
          }, t('online.preview')),
          ...actions.map((action, i) => actionButton(action, i, `online:${item.id}:${i}`, busy || (options.disabled && options.disabled()),
            () => runOnline({ id: item.id }, item, action, i))),
        ];
      }
      const existing = (row && (row.kind === 'imported' || row.kind === 'exists')) ? row.songId : item.existingId;
      if (existing) {
        const imported = row && row.kind === 'imported';
        return [
          el('span', { class: `row-state${imported ? ' success' : ''}`, text: t(imported ? 'online.importedShort' : 'online.exists') }),
          el('a', { class: 'button secondary', href: `/songs/${existing}`, 'data-icon': 'jump', text: t('online.open'), 'aria-label': t('online.openSongTitle', { title: item.title }) }),
        ];
      }
      return [
        el('button', {
          type: 'button', class: 'secondary', disabled: busy, 'data-icon': 'follow',
          'aria-label': t('online.previewSong', { title: item.title }),
          onclick: () => openPreview({ id: item.id }, item.id),
        }, t('online.preview')),
        el('button', {
          // One import button per result: secondary (a list of filled buttons reads as options).
          type: 'button', class: 'secondary', disabled: busy, 'data-icon': 'import',
          'aria-label': t('online.importSong', { title: item.title }),
          onclick: () => importRow(item),
        }, online.busy === `row:${item.id}` ? t('online.importing') : t('online.import')),
      ];
    }

    function renderOnline() {
      onlineButton.hidden = !online.allowed;
      onlineButton.disabled = online.busy === 'search';
      section.hidden = !online.shown;
      const st = online.status;
      onlineStatus.replaceChildren(...(st ? [st.spin ? el('span', { class: 'spinner', 'aria-hidden': 'true' }) : null, t(st.key, st.vars)] : []));
      onlineStatus.hidden = !st;
      errorBox.textContent = online.error || '';
      const results = online.results || [];
      $('online-count').textContent = online.results && results.length ? `(${results.length})` : '';
      resultsList.replaceChildren(...results.map((item) => {
        const row = online.rows.get(item.id);
        return el('li', { class: 'result-row' },
          el('div', { class: 'result-text' },
            el('span', { class: 'song-title', text: item.title }),
            item.author ? el('span', { class: 'song-meta', text: item.author }) : null,
            row && row.kind === 'error' ? el('span', { class: 'message error', role: 'alert', text: row.text }) : null,
            row && row.kind === 'done' ? el('span', { class: 'message success', role: 'status', text: row.text }) : null),
          el('div', { class: 'result-actions' }, ...rowActions(item)));
      }));
      renderPreview();
    }

    function render() {
      renderLocal();
      renderOnline();
    }

    function renderPreview() {
      const pv = online.preview;
      if (!pv) return;
      const song = pv.song;
      previewTitle.textContent = song.title;
      previewMeta.textContent = [
        song.key ? t('song.key', { key: window.NOTATION.chord(song.key) }) : null,
        song.author ? t('song.author', { author: song.author }) : null,
        song.presentation ? t('online.presentation', { order: song.presentation }) : null,
      ].filter(Boolean).join(' · ');
      previewSections.replaceChildren(...window.SONG_RENDER.sectionsView(song.sections, { headingLevel: 3 }));

      const outcome = online.outcome;
      let message = [];
      let tone = '';
      if (outcome && outcome.kind === 'imported') {
        tone = 'success';
        message = [t('online.imported'), ' ', el('a', { href: `/songs/${outcome.id}`, text: t('online.openSong') })];
      } else if (outcome && outcome.kind === 'done') {
        tone = 'success';
        message = [outcome.text];
      } else if (outcome && outcome.kind === 'error') {
        tone = 'error';
        message = [outcome.text];
      } else if (mode === 'library' && (pv.existingId || (outcome && outcome.kind === 'exists'))) {
        tone = 'error';
        message = [t('online.alreadyExists'), ' ', el('a', { href: `/songs/${pv.existingId || outcome.id}`, text: t('online.openExisting') })];
      } else if (pv.existingId) {
        message = [t('online.alreadyExistsUse')]; // pick: the library's copy is used
      } else if (pv.invalid) {
        tone = 'error';
        message = [pv.invalid];
      }
      previewMessage.className = `message ${tone}`;
      previewMessage.replaceChildren(...message);

      if (mode === 'library') {
        const blocked = Boolean(pv.existingId || pv.invalid || (outcome && outcome.kind !== 'error'));
        importButton.disabled = blocked || online.busy === 'import';
        importButton.hidden = Boolean(outcome && outcome.kind === 'imported');
        importButton.textContent = online.busy === 'import' ? t('online.importing') : t('online.import');
        return;
      }
      const item = { id: pv.resultId, title: song.title, author: song.author };
      const actions = options.onlineActions ? options.onlineActions(item) : [];
      const blocked = Boolean(!pv.existingId && pv.invalid) || Boolean(outcome && outcome.kind === 'done');
      previewActions.replaceChildren(...actions.map((action, i) => actionButton({ ...action, primary: i === 0 }, i, `preview:${i}`,
        blocked || Boolean(online.busy) || (options.disabled && options.disabled()), () => runOnline(pv.source, item, action, i, true))));
    }

    async function search(query) {
      online.shown = true;
      online.query = query;
      online.results = null;
      online.rows = new Map();
      online.error = null;
      if (query.length < 2) {
        online.status = null;
        online.error = t('errors.resurseQueryTooShort');
        renderOnline();
        return;
      }
      online.busy = 'search';
      online.status = { key: 'online.searching', spin: true };
      renderOnline();
      try {
        const res = await api('/api/resurse/search', { method: 'POST', body: { query } });
        if (online.query !== query) return; // the query changed meanwhile
        if (res.ok) {
          online.results = res.body;
          online.status = res.body.length === 0 ? { key: 'online.noResults', vars: { q: query } } : null;
        } else {
          online.status = null;
          online.error = failText(res);
        }
      } catch (err) {
        online.status = null;
        online.error = t('common.networkError');
      } finally {
        online.busy = false;
        renderOnline();
      }
    }

    async function openPreview(source, resultId) {
      online.busy = 'preview';
      online.error = null;
      online.outcome = null;
      online.status = { key: 'online.loadingPreview', spin: true };
      renderOnline();
      try {
        const res = await api('/api/resurse/preview', { method: 'POST', body: source });
        if (res.ok) {
          online.preview = { source, resultId, song: res.body.song, existingId: res.body.existingId, invalid: res.body.invalid };
          online.status = null;
        } else {
          online.status = null;
          online.error = failText(res);
        }
      } catch (err) {
        online.status = null;
        online.error = t('common.networkError');
      } finally {
        online.busy = false;
        renderOnline();
        if (online.preview && !dialog.open) {
          dialog.showModal();
          previewTitle.focus({ preventScroll: true });
        }
      }
    }

    function imported(resultId, songId) {
      if (resultId) online.rows.set(resultId, { kind: 'imported', songId });
      document.dispatchEvent(new CustomEvent('library:changed'));
    }

    async function importRow(item) {
      online.busy = `row:${item.id}`;
      online.rows.delete(item.id);
      renderOnline();
      try {
        const res = await api('/api/resurse/import', { method: 'POST', body: { id: item.id } });
        if (res.status === 201) imported(item.id, res.body.song.id);
        else if (res.status === 409) online.rows.set(item.id, { kind: 'exists', songId: res.body.existingId });
        else online.rows.set(item.id, { kind: 'error', text: failText(res) });
      } catch (err) {
        online.rows.set(item.id, { kind: 'error', text: t('common.networkError') });
      } finally {
        online.busy = false;
        renderOnline();
      }
    }

    // Pick mode: import (or take the library's copy), then the caller's action.
    async function runOnline(source, item, action, i, fromPreview) {
      online.busy = fromPreview ? `preview:${i}` : `online:${item.id}:${i}`;
      if (item.id) online.rows.delete(item.id);
      online.outcome = null;
      renderOnline();
      const fail = (text) => {
        if (fromPreview) online.outcome = { kind: 'error', text };
        if (item.id) online.rows.set(item.id, { kind: 'error', text });
      };
      try {
        const res = await api('/api/resurse/import', { method: 'POST', body: source });
        let songId = null;
        if (res.status === 201) {
          songId = res.body.song.id;
          document.dispatchEvent(new CustomEvent('library:changed'));
        } else if (res.status === 409 && res.body.existingId) songId = res.body.existingId;
        else fail(failText(res));
        if (songId) {
          const out = await action.run(songId, item);
          if (out && out.error) fail(out.error);
          else {
            // Done: the preview closes; the result says so in this search (row or status).
            const text = (out && out.done) || t('online.importedShort');
            if (item.id) online.rows.set(item.id, { kind: 'done', text });
            else local.message = { text, tone: 'success' };
            if (fromPreview && dialog.open) dialog.close();
          }
          load(); // the imported song is a library song now
        }
      } catch (err) {
        fail(t('common.networkError'));
      } finally {
        online.busy = false;
        renderOnline();
      }
    }

    // --- events -------------------------------------------------------------------------

    input.addEventListener('input', () => {
      clearTimeout(local.timer);
      local.message = null;
      local.timer = setTimeout(load, SEARCH_DELAY_MS);
      // A different query makes the online results stale: hide them until the next Enter.
      if (!online.shown || input.value.trim() === online.query) return;
      Object.assign(online, { shown: false, query: '', results: null, rows: new Map(), status: null, error: null });
      renderOnline();
    });
    // A new tap replaces the old query: select all on focus, and keep the selection through the
    // mouseup (also emulated after a tap) that would otherwise place the caret.
    let keepSelection = false;
    input.addEventListener('focus', () => {
      input.select();
      keepSelection = true;
    });
    input.addEventListener('mouseup', (event) => {
      if (keepSelection) event.preventDefault();
      keepSelection = false;
    });
    input.addEventListener('keydown', () => { keepSelection = false; });
    // Enter: the library right away, and resurse when allowed. After a search the field lets
    // go of focus (on phones the keyboard closes and the results show); the next tap selects
    // the whole query again.
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearTimeout(local.timer);
      load();
      input.blur();
      if (!online.allowed) return;
      const query = input.value.trim();
      if (!query) return;
      if (isLink(query)) {
        // A pasted link: its preview (another host -> the server's clear error).
        online.shown = true;
        online.query = query;
        online.results = null;
        online.rows = new Map();
        openPreview({ url: query }, null);
        return;
      }
      search(query);
    });
    if (sort) sort.addEventListener('change', load);

    if (importButton) {
      importButton.addEventListener('click', async () => {
        const pv = online.preview;
        if (!pv) return;
        online.busy = 'import';
        online.outcome = null;
        renderPreview();
        try {
          const res = await api('/api/resurse/import', { method: 'POST', body: pv.source });
          if (res.status === 201) {
            online.outcome = { kind: 'imported', id: res.body.song.id };
            imported(pv.resultId, res.body.song.id);
          } else if (res.status === 409) {
            online.outcome = { kind: 'exists', id: res.body.existingId };
            if (pv.resultId) online.rows.set(pv.resultId, { kind: 'exists', songId: res.body.existingId });
          } else {
            online.outcome = { kind: 'error', text: failText(res) };
          }
        } catch (err) {
          online.outcome = { kind: 'error', text: t('common.networkError') };
        } finally {
          online.busy = false;
          renderOnline();
        }
      });
    }

    for (const close of [$('preview-close'), $('preview-close-x')]) close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      online.preview = null;
      online.outcome = null;
      renderOnline();
    });
    // A tap on the dimmed area closes it too.
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      if (!inside) dialog.close();
    });
    // The dialog's Escape must not also close a dialog it sits in (the editor's "+ Cântare").
    dialog.addEventListener('cancel', (event) => event.stopPropagation());

    if (mode === 'library') document.addEventListener('library:changed', load);
    document.addEventListener('notation:change', render);
    document.addEventListener('i18n:change', () => {
      // Server messages are in the previous language; drop them rather than mix languages.
      online.error = null;
      local.message = null;
      if (online.outcome && (online.outcome.kind === 'error' || online.outcome.kind === 'done')) online.outcome = null;
      for (const [id, row] of online.rows) if (row.kind === 'error' || row.kind === 'done') online.rows.delete(id);
      render();
    });

    return {
      input,
      setOnline(allowed) {
        online.allowed = Boolean(allowed);
        render();
      },
      setMe(value) {
        me = value;
        renderLocal();
      },
      reload: load,
      render,
      // Back to an empty field (the pick dialog opening again).
      reset() {
        input.value = '';
        local.songs = null;
        local.message = null;
        list.replaceChildren();
        Object.assign(online, { shown: false, query: '', results: null, rows: new Map(), status: null, error: null });
        setStatus(t('library.loading'));
        render();
        load();
      },
      focus() { input.focus(); },
    };
  }

  window.SONG_SEARCH = { create };
})();
