'use strict';

// "Acorduri și teme de pe resurse" on /library (the "⋯" menu, whoever writes the shown
// library): the songs without chords or without themes are looked up on resursecrestine.ro
// one by one (lib/resurse-sync.js, POST /api/resurse/sync): the site's chords land over the
// song's own lines, its themes ("Tematica") are added, the key is set where none was. The
// review replaces the library's search and list: first what will be looked at and "Pornește",
// then the progress (GET /api/resurse/sync every 2 s), then the report, one row per song with
// its outcome; a song the site did not have, or had with another text, offers "Caută pe
// resurse" (the library's online search with its title). A run started earlier keeps going
// while the page is away and shows on the next opening.

(function () {
  const { api, el } = window.PAGE;
  const { t } = window.I18N;
  const POLL_MS = 2000;
  const STATUS_KEYS = { chords: 'resurseSync.rowChords', themes: 'resurseSync.rowThemes', different: 'resurseSync.rowDifferent', notFound: 'resurseSync.rowNotFound', error: 'resurseSync.rowError', skipped: 'resurseSync.rowSkipped' };
  const ORDER = ['chords', 'themes', 'different', 'notFound', 'error', 'skipped'];

  const review = document.getElementById('sync-review');
  if (!review) return;
  const heading = document.getElementById('sync-review-heading');
  const status = document.getElementById('sync-review-status');
  const errorBox = document.getElementById('sync-review-error');
  const progress = document.getElementById('sync-progress');
  const bar = document.getElementById('sync-progress-bar');
  const progressText = document.getElementById('sync-progress-text');
  const listBox = document.getElementById('sync-review-list');
  const actions = document.getElementById('sync-review-actions');
  const startButton = document.getElementById('sync-review-start');
  const cancelButton = document.getElementById('sync-review-cancel');
  const libraryParts = ['library-collections', 'library-search', 'library-results', 'key-review'].map((id) => document.getElementById(id));

  const state = { plan: null, job: null, error: null, busy: false, collection: 'main' };
  let hiddenBefore = [];
  let timer = null;

  const collectionName = () => t(state.collection === 'school' ? 'library.collectionSchool' : 'library.collectionMain');
  const running = () => Boolean(state.job && state.job.running);
  const finished = () => Boolean(state.job && !state.job.running);

  function summary(report) {
    const counts = {};
    for (const e of report) counts[e.status] = (counts[e.status] || 0) + 1;
    return el('ul', { class: 'sync-summary' }, ORDER.filter((k) => counts[k]).map((k) => el('li', null, el('span', { class: `sync-row-status is-${k}`, text: t(STATUS_KEYS[k]) }), ` ${counts[k]}`)));
  }

  // "Caută pe resurse": back to the library with the song's title in the online search.
  function searchOnline(title) {
    close();
    const q = document.getElementById('q');
    q.value = title;
    q.dispatchEvent(new Event('input', { bubbles: true }));
    const online = document.getElementById('online-search');
    if (online && !online.hidden) online.click();
  }

  function row(entry) {
    const details = [];
    if (entry.themes && entry.themes.length) details.push(t('resurseSync.rowThemesAdded', { themes: entry.themes.join(', ') }));
    if (entry.key) details.push(t('resurseSync.rowKeySet', { key: window.NOTATION ? window.NOTATION.chord(entry.key) : entry.key }));
    if (entry.status === 'different' && entry.url) details.push(t('resurseSync.rowScore', { n: Math.round((entry.score || 0) * 100) }));
    return el('li', { class: `key-review-row sync-row is-${entry.status}`, 'data-song-id': entry.id, 'data-status': entry.status },
      el('div', { class: 'key-review-main' },
        el('a', { class: 'key-review-title', href: `/songs/${entry.id}`, text: entry.title }),
        details.length ? el('span', { class: 'muted key-review-meta', text: details.join(' · ') }) : null),
      el('span', { class: `sync-row-status is-${entry.status}`, text: t(STATUS_KEYS[entry.status] || 'resurseSync.rowError') }),
      ['notFound', 'different', 'error'].includes(entry.status)
        ? el('button', { type: 'button', class: 'secondary sync-row-search', 'data-icon': 'search', 'aria-label': t('resurseSync.searchFor', { title: entry.title }), text: t('resurseSync.search'), onclick: () => searchOnline(entry.title) })
        : null);
  }

  function render() {
    const job = state.job;
    const plan = state.plan;
    errorBox.textContent = state.error || '';
    progress.hidden = !job;
    if (!job) progressText.textContent = '';
    if (job) {
      bar.max = Math.max(1, job.total);
      bar.value = job.done;
      progressText.textContent = running()
        ? t('resurseSync.progress', { done: job.done, total: job.total, title: job.current || '…' })
        : t(job.cancelled ? 'resurseSync.stopped' : 'resurseSync.finished', { done: job.done, total: job.total });
    }
    // the intro (what a run would look at) whenever nothing runs: a finished run's report
    // stays below, and another run can start
    if (running()) status.textContent = t('resurseSync.running');
    else {
      status.textContent = plan
        ? (plan.total ? t('resurseSync.intro', { n: plan.total, chords: plan.withoutChords, themes: plan.withoutThemes, library: collectionName() }) : t('resurseSync.nothing', { library: collectionName() }))
        : t('resurseSync.loading');
    }
    listBox.replaceChildren(...(job && job.report.length
      ? [summary(job.report), el('ul', { class: 'key-review-rows', 'aria-label': t('resurseSync.heading') }, job.report.map(row))]
      : [el('p', { class: 'muted pane-state', text: running() ? t('resurseSync.waiting') : (plan && plan.total ? t('resurseSync.hint') : '') })]));
    startButton.hidden = running();
    startButton.disabled = state.busy || !plan || !plan.total;
    startButton.textContent = plan && plan.total ? t('resurseSync.start', { n: plan.total }) : t('resurseSync.startNone');
    cancelButton.textContent = t(running() ? 'resurseSync.stop' : (finished() ? 'keySuggest.back' : 'resurseSync.cancel'));
  }

  async function poll() {
    const res = await api(`/api/resurse/sync?collection=${state.collection}`).catch(() => null);
    if (!res || !res.ok) {
      state.error = (res && res.body && res.body.error) || t('common.networkError');
      render();
      return;
    }
    state.plan = res.body.plan;
    state.job = res.body.job;
    render();
    if (finished() && state.job.report.some((e) => ['chords', 'themes'].includes(e.status))) document.dispatchEvent(new CustomEvent('library:changed'));
    clearTimeout(timer);
    if (running() && !review.hidden) timer = setTimeout(poll, POLL_MS);
  }

  function open() {
    hiddenBefore = libraryParts.map((node) => node && node.hidden);
    libraryParts.forEach((node) => { if (node) node.hidden = true; });
    review.hidden = false;
    heading.focus();
  }

  function close() {
    clearTimeout(timer);
    review.hidden = true;
    libraryParts.forEach((node, i) => { if (node) node.hidden = hiddenBefore[i]; });
    Object.assign(state, { plan: null, job: null, error: null, busy: false });
    document.getElementById('library-menu-button').focus();
  }

  async function show() {
    const switchNode = document.querySelector('#collection-switch [aria-pressed="true"]');
    state.collection = switchNode && switchNode.dataset.collection === 'school' ? 'school' : 'main';
    Object.assign(state, { plan: null, job: null, error: null, busy: false });
    open();
    render();
    await poll();
  }

  async function start() {
    state.busy = true;
    state.error = null;
    state.job = null; // a finished run's report makes way for the new one
    render();
    const res = await api(`/api/resurse/sync?collection=${state.collection}`, { method: 'POST' }).catch(() => null);
    state.busy = false;
    if (!res || !res.ok) {
      state.error = (res && res.body && res.body.error) || t('common.networkError');
      if (res && res.body && res.body.job) state.job = res.body.job;
      render();
      if (running()) timer = setTimeout(poll, POLL_MS);
      return;
    }
    state.job = res.body.job;
    render();
    timer = setTimeout(poll, Math.min(POLL_MS, 500));
  }

  async function stop() {
    if (!running()) { close(); return; }
    await api(`/api/resurse/sync?collection=${state.collection}`, { method: 'DELETE' }).catch(() => null);
    await poll();
  }

  document.getElementById('resurse-sync').addEventListener('click', show);
  startButton.addEventListener('click', start);
  cancelButton.addEventListener('click', stop);
  document.addEventListener('i18n:change', () => { if (!review.hidden) render(); });
  document.addEventListener('notation:change', () => { if (!review.hidden) render(); });
})();
