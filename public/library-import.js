'use strict';

// Library file import on /library: pick a .json file -> dry run preview (new / existing /
// invalid) -> choose skip or update -> import -> summary (owner and leader).

(function () {
  const { api, el } = window.PAGE;
  const { t } = window.I18N;
  const MAX_BYTES = 10 * 1024 * 1024;

  const fileInput = document.getElementById('import-file');
  const review = document.getElementById('import-review');
  const heading = document.getElementById('import-heading');
  const fileName = document.getElementById('import-file-name');
  const status = document.getElementById('import-status');
  const errorBox = document.getElementById('import-error');
  const planBox = document.getElementById('import-plan');
  const modeBox = document.getElementById('import-mode');
  const runButton = document.getElementById('import-run');
  const resultBox = document.getElementById('import-result');
  const summary = document.getElementById('import-summary');
  const libraryParts = ['library-tabs', 'panel-local', 'panel-online'].map((id) => document.getElementById(id));

  const state = { name: '', text: null, status: null, error: null, plan: null, result: null, busy: false };
  let hiddenBefore = [];

  function mode() {
    return document.querySelector('input[name="import-mode"]:checked').value;
  }

  function importCount() {
    if (!state.plan) return 0;
    return state.plan.new.length + (mode() === 'update' ? state.plan.existing.length : 0);
  }

  function fillList(id, titleKey, items, format) {
    const details = document.getElementById(id);
    details.querySelector('summary').textContent = t(titleKey, { n: items.length });
    details.querySelector('ul').replaceChildren(...(items.length
      ? items.map((item) => el('li', { text: format(item) }))
      : [el('li', { class: 'muted', text: t('import.none') })]));
  }

  function render() {
    fileName.textContent = state.name ? t('import.fileName', { name: state.name }) : '';
    status.textContent = state.status ? t(state.status) : '';
    errorBox.textContent = state.error ? (state.error.key ? t(state.error.key) : state.error.text) : '';

    const plan = state.plan;
    planBox.hidden = !plan || Boolean(state.result);
    // Cancel stays available (e.g. after an invalid file); Import only with a plan.
    document.getElementById('import-actions').hidden = Boolean(state.result);
    runButton.hidden = !plan;
    if (plan) {
      fillList('import-new', 'import.newSongs', plan.new, (title) => title);
      fillList('import-existing', 'import.existingSongs', plan.existing, (title) => title);
      fillList('import-invalid', 'import.invalidSongs', plan.invalid, (x) => t('import.invalidItem', { title: x.title, reason: x.reason }));
      modeBox.hidden = plan.existing.length === 0;
      const n = importCount();
      runButton.disabled = n === 0 || state.busy;
      runButton.textContent = state.busy ? t('import.running')
        : n === 0 ? t('import.runNone') : n === 1 ? t('import.runOne') : t('import.run', { n });
    }

    resultBox.hidden = !state.result;
    if (state.result) {
      const r = state.result;
      summary.replaceChildren(
        el('li', { text: t('import.done') }),
        el('li', { text: t('import.added', { n: r.added }) }),
        el('li', { text: t('import.updated', { n: r.updated }) }),
        el('li', { text: t('import.skipped', { n: r.skipped }) }),
        el('li', { text: t('import.invalid', { n: r.invalid }) }),
      );
    }
  }

  function open() {
    hiddenBefore = libraryParts.map((node) => node.hidden);
    libraryParts.forEach((node) => { node.hidden = true; });
    review.hidden = false;
    heading.focus();
  }

  function close() {
    review.hidden = true;
    libraryParts.forEach((node, i) => { node.hidden = hiddenBefore[i]; });
    Object.assign(state, { name: '', text: null, status: null, error: null, plan: null, result: null, busy: false });
    fileInput.value = '';
    document.getElementById('import-library').focus();
  }

  function serverError(res) {
    return { text: (res.body && res.body.error) || t('common.networkError') };
  }

  document.getElementById('import-library').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    Object.assign(state, { name: file.name, text: null, plan: null, result: null, error: null, status: 'import.checking' });
    open();
    render();
    try {
      if (file.size > MAX_BYTES) throw Object.assign(new Error('too large'), { key: 'import.tooLarge' });
      const text = await file.text();
      try {
        JSON.parse(text);
      } catch (err) {
        throw Object.assign(new Error('not json'), { key: 'import.notJson' });
      }
      const res = await api('/api/songs/import?dryRun=1', { method: 'POST', body: text, headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) {
        state.error = serverError(res);
      } else {
        state.text = text;
        state.plan = res.body;
        state.status = res.body.format === 'sanctuary-voice-library' ? 'import.formatSv' : 'import.formatOwn';
        if (res.body.existing.length) document.getElementById('import-existing').open = true;
        if (res.body.invalid.length) document.getElementById('import-invalid').open = true;
      }
    } catch (err) {
      state.error = err.key ? { key: err.key } : { key: 'common.networkError' };
    }
    if (state.error) state.status = null;
    render();
  });

  modeBox.addEventListener('change', render);

  runButton.addEventListener('click', async () => {
    state.busy = true;
    state.error = null;
    render();
    try {
      const res = await api(`/api/songs/import?mode=${mode()}`, { method: 'POST', body: state.text, headers: { 'Content-Type': 'application/json' } });
      if (res.ok) {
        state.result = res.body;
        state.status = null;
        document.dispatchEvent(new CustomEvent('library:changed'));
      } else {
        state.error = serverError(res);
      }
    } catch (err) {
      state.error = { key: 'common.networkError' };
    } finally {
      state.busy = false;
      render();
      if (state.result) document.getElementById('import-done').focus();
    }
  });

  document.getElementById('import-cancel').addEventListener('click', close);
  document.getElementById('import-done').addEventListener('click', close);

  document.addEventListener('i18n:change', () => {
    if (state.error && !state.error.key) state.error = null;
    if (!review.hidden) render();
  });
})();
