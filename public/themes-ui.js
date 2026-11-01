'use strict';

// "Tematică" on the song page: the song's themes as chips (links to the library filtered by
// the theme) and, for the editor roles, "Setează": a pop-up with the thematic index
// (lib/themes.js, after resursecrestine.ro's), the library's own themes and a field for any
// other theme; tap to select, "Salvează" writes them (PUT /api/songs/:id/themes).

(function () {
  let dialog = null;
  let state = null; // { song, onSaved, chosen: [names], lists: { index, used }, status, error }

  const norm = (s) => String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function build() {
    const { el } = window.PAGE;
    dialog = el('dialog', { class: 'themes-dialog', id: 'themes-dialog', 'aria-labelledby': 'themes-dialog-title' });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    document.body.append(dialog);
  }

  // { index, used } from GET /api/songs/themes (fresh on every open: the library's themes change)
  async function loadLists() {
    const res = await window.PAGE.api('/api/songs/themes').catch(() => null);
    return res && res.ok ? { index: res.body.index || [], used: (res.body.themes || []).map((x) => x.name) } : { index: [], used: [] };
  }

  function has(name) {
    return state.chosen.some((x) => norm(x) === norm(name));
  }

  function toggle(name) {
    if (has(name)) state.chosen = state.chosen.filter((x) => norm(x) !== norm(name));
    else state.chosen.push(name);
    state.error = null;
    render();
  }

  function chip(name) {
    const { el } = window.PAGE;
    return el('button', { type: 'button', class: 'theme-pick', 'data-theme': name, 'aria-pressed': String(has(name)), text: name, onclick: () => toggle(name) });
  }

  async function save() {
    const { api } = window.PAGE;
    state.status = 'saving';
    render();
    const res = await api(`/api/songs/${state.song.id}/themes`, { method: 'PUT', body: { themes: state.chosen } }).catch(() => null);
    state.status = null;
    if (res && res.ok) {
      state.song.themes = res.body.song.themes;
      dialog.close();
      if (state.onSaved) state.onSaved(res.body.song);
      return;
    }
    state.error = (res && res.body && res.body.error) || window.I18N.t('common.networkError');
    render();
  }

  function render() {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const index = state.lists.index;
    const extra = [...new Set([...state.lists.used, ...state.chosen])].filter((name) => !index.some((x) => norm(x) === norm(name)));
    const other = el('input', { type: 'text', id: 'themes-other', maxlength: '40', autocomplete: 'off', placeholder: t('themes.otherPlaceholder'), 'aria-label': t('themes.other') });
    const addOther = () => {
      const name = other.value.trim().replace(/\s+/g, ' ');
      if (!name) return;
      if (!has(name)) state.chosen.push(name);
      other.value = '';
      state.error = null;
      render();
    };
    other.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addOther(); } });
    dialog.replaceChildren(...[
      el('div', { class: 'chord-dialog-head' },
        el('h2', { id: 'themes-dialog-title', text: t('themes.title') }),
        el('button', { type: 'button', class: 'secondary chord-close', 'data-icon': 'close', 'aria-label': t('chordDiagram.close'), onclick: () => dialog.close() })),
      el('p', { class: 'muted themes-chosen', id: 'themes-chosen', text: state.chosen.length ? t('themes.chosen', { themes: state.chosen.join(', ') }) : t('themes.none') }),
      el('h3', { class: 'themes-group-title', text: t('themes.index') }),
      el('div', { class: 'themes-picks', role: 'group', 'aria-label': t('themes.index') }, ...index.map(chip)),
      extra.length ? el('h3', { class: 'themes-group-title', text: t('themes.used') }) : null,
      extra.length ? el('div', { class: 'themes-picks', role: 'group', 'aria-label': t('themes.used') }, ...extra.map(chip)) : null,
      el('div', { class: 'themes-other' },
        el('label', { for: 'themes-other', class: 'themes-group-title', text: t('themes.other') }),
        el('div', { class: 'input-row' }, other, el('button', { type: 'button', class: 'secondary', id: 'themes-other-add', 'data-icon': 'plus', text: t('themes.add'), onclick: addOther }))),
      el('p', { class: state.error ? 'message error' : 'message', role: 'alert', text: state.error || '' }),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', id: 'themes-save', 'data-icon': 'check', disabled: state.status === 'saving', text: t('themes.save'), onclick: save }),
        el('button', { type: 'button', class: 'secondary', text: t('keyDetect.cancel'), onclick: () => dialog.close() })),
    ].filter(Boolean)); // replaceChildren(null) would print "null"
  }

  // The pop-up for a song ({ id, themes }); onSaved(song) after a save.
  async function open(song, { onSaved } = {}) {
    if (!dialog) build();
    state = { song, onSaved, chosen: (song.themes || []).slice(), lists: await loadLists(), status: null, error: null };
    render();
    if (!dialog.open) dialog.showModal();
  }

  // The row under the title: "Tematică: [chips] · Setează" (chips only for the team).
  function box(song, canSet, onSaved) {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const themes = song.themes || [];
    const row = el('div', { class: 'song-themes', id: 'song-themes-box', role: 'group', 'aria-label': t('song.themesLabel') });
    row.append(el('span', { class: 'song-themes-label', text: `${t('song.themesLabel')}:` }));
    if (themes.length) row.append(...themes.map((name) => el('a', { class: 'theme-chip', href: `/library?theme=${encodeURIComponent(name)}`, text: name })));
    else row.append(el('span', { class: 'muted song-themes-none', text: t(canSet ? 'themes.unset' : 'themes.noneShort') }));
    if (canSet) {
      row.append(el('span', { class: 'song-key-dot', 'aria-hidden': 'true', text: '·' }),
        el('button', { type: 'button', class: 'song-key-change song-themes-set', 'data-icon': 'edit', text: t(themes.length ? 'song.keyChange' : 'song.keySet'), onclick: () => open(song, { onSaved }) }));
    }
    return row;
  }

  document.addEventListener('i18n:change', () => { if (dialog && dialog.open && state) render(); });

  window.THEMES_UI = { open, box };
})();
