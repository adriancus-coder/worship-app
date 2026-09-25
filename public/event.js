'use strict';

// Event page: /events/:id (read-only) and /events/:id/edit (owner, leader).
// The setlist lives in `state.items`; the list and the detail pane are re-rendered from it.
// Changes are saved explicitly. Unsaved changes are protected three ways: beforeunload
// (desktop), an in-app dialog on internal links (iPhone/iPad Safari and Edge never show the
// beforeunload prompt) and a local draft backup restored on the next visit.

(function () {
  const { api, el, canEdit: canEditLibrary, canEditEvents: canEdit, EVENT_ROLES, setTitle, formatDate, backLink, keepFrom } = window.PAGE;
  const { t } = window.I18N;

  const [, , eventId, editSegment] = window.location.pathname.split('/');
  const $ = (id) => document.getElementById(id);
  const status = $('status');
  const itemsList = $('items');
  const detail = $('detail');
  const detailHome = $('detail-home');
  const saveButton = $('save-button');
  const saveState = $('save-state');
  const actionMessage = $('action-message');
  const publishButton = $('publish-button');
  const templateButton = $('template-button');
  const wide = window.matchMedia('(min-width: 900px)');

  const state = {
    me: null,
    editing: false,
    event: null,
    today: null,
    items: [], // { key, type, songId, title, body, reference, url, durationMin, song, songDeleted }
    saved: '', // JSON of the last saved items, for the "unsaved changes" check
    selected: -1,
    saving: false,
    lastSaveError: null,
    songCache: new Map(), // songId -> song with sections (or 'loading' / 'error')
    media: null, // the media library (videos), loaded for editors
  };
  let nextKey = 1;

  // --- helpers ----------------------------------------------------------------

  // Custom arrangement to save, or null for the default. Codes that no longer resolve
  // (the song was edited) are dropped so the save is not rejected.
  function arrangementPayload(item) {
    if (item.arrangementIsDefault !== false) return null;
    if (item.songDeleted || !item.songId) return item.arrangement || null;
    const codes = Array.isArray(item.arrangementCodes)
      ? item.arrangementCodes
      : (item.arrangementResolved || []).map((r) => r.code);
    return codes.join(' ') || null;
  }

  function payload(items) {
    return items.map((item) => {
      const { type, songId, mediaId, title, body, reference, url, durationMin } = item;
      const out = {
        id: item.id || null, // saved items keep their id (live mode follows items by id)
        type,
        songId: type === 'song' ? songId : null,
        mediaId: type === 'video' && mediaId ? mediaId : null,
        title: title || '',
        body: body || '',
        reference: reference || '',
        url: url || '',
        durationMin: durationMin === '' || durationMin === null || durationMin === undefined ? null : Number(durationMin),
      };
      // Per-event song options (only song items may carry them).
      if (type === 'song') {
        Object.assign(out, {
          transpose: Number(item.transpose) || 0,
          arrangement: arrangementPayload(item),
          teamNote: item.teamNote || '',
          referenceUrl: item.referenceUrl || '',
        });
      }
      return out;
    });
  }

  function isDirty() {
    return state.editing && JSON.stringify(payload(state.items)) !== state.saved;
  }

  function fromServer(item) {
    const out = { ...item, key: nextKey++ };
    if (item.type === 'song' && Array.isArray(item.arrangementResolved) && item.songId) {
      out.arrangementCodes = item.arrangementResolved.map((r) => r.code);
    }
    return out;
  }

  function itemTitle(item) {
    if (item.type === 'song') return item.title || t('setlist.songDeleted');
    if (item.type === 'verse') return item.reference || item.title || t('setlist.types.verse');
    return item.title || (item.body ? item.body.split('\n')[0].slice(0, 80) : '') || t('setlist.untitled');
  }

  function itemSubline(item) {
    const parts = [];
    if (item.type === 'song') {
      if (item.songDeleted) parts.push(t('setlist.songDeleted'));
      else if (item.song) {
        const key = songKeySubline(item);
        if (key) parts.push(key);
        parts.push(item.song.sectionCount === 1 ? t('setlist.sectionCountOne') : t('setlist.sectionCount', { n: item.song.sectionCount }));
      }
    } else if (item.type === 'verse' && item.body) {
      parts.push(item.body.split('\n')[0].slice(0, 60));
    } else if (item.type === 'video' && item.media) {
      parts.push(t('setlist.mediaFromLibrary'));
    } else if (item.type === 'video' && item.url) {
      try { parts.push(new URL(item.url).hostname); } catch (err) { parts.push(item.url); }
    }
    if (item.durationMin) parts.push(t('setlist.minutes', { n: item.durationMin }));
    return parts.join(' · ');
  }

  function countText(n) {
    if (n === 0) return t('events.itemCountZero');
    return n === 1 ? t('events.itemCountOne') : t('events.itemCount', { n });
  }

  function lastSungText(lastSung) {
    if (!lastSung || !state.today) return t('setlist.neverSung');
    const days = Math.round((Date.parse(`${state.today}T00:00:00Z`) - Date.parse(`${lastSung}T00:00:00Z`)) / 86400000);
    const weeks = Math.floor(days / 7);
    if (weeks <= 0) return t('setlist.lastSungThisWeek');
    if (weeks === 1) return t('setlist.lastSungOneWeek');
    return t(weeks >= 20 ? 'setlist.lastSungManyWeeks' : 'setlist.lastSungWeeks', { n: weeks });
  }

  // --- header -------------------------------------------------------------------

  function renderHeader() {
    const ev = state.event;
    setTitle('setlist.pageTitle', { name: ev.name });
    $('event-name').textContent = ev.name;
    $('event-when').textContent = ev.isTemplate
      ? t('events.template')
      : [formatDate(ev.eventDate, state.today && state.today.slice(0, 4)), ev.startTime].filter(Boolean).join(' · ');
    const pill = $('event-status');
    pill.className = ev.isTemplate ? 'pill pill-template' : `pill pill-${ev.status}`;
    pill.textContent = ev.isTemplate ? t('events.template') : t(`events.status.${ev.status}`);
    const minutes = state.items.reduce((sum, it) => sum + (Number(it.durationMin) || 0), 0);
    const count = countText(state.items.length);
    $('event-counts').textContent = minutes ? t('setlist.summary', { count, minutes }) : count;
    $('event-notes').hidden = !ev.notes;
    $('event-notes').textContent = ev.notes || '';

    const editor = canEdit(state.me);
    $('edit-link').hidden = !editor || state.editing;
    $('edit-link').href = keepFrom(`/events/${ev.id}/edit`);
    $('rehearse-link').href = keepFrom(`/events/${ev.id}/rehearse`);
    const back = backLink();
    $('back-link').href = back.href;
    $('back-link').textContent = back.text;
    // Live control for owner / leader once the event is published (or already live).
    $('live-link').hidden = !editor || ev.isTemplate || !['published', 'live'].includes(ev.status);
    $('live-link').href = `/events/${ev.id}/live`;
    $('follow-link').hidden = ev.status !== 'live';
    $('follow-link').href = `/events/${ev.id}/follow`;
    // The operator console for the roles that run the projector, while the event is live.
    $('operator-link').hidden = ev.status !== 'live' || !EVENT_ROLES.includes(state.me && state.me.user.role);
    $('operator-link').href = `/events/${ev.id}/operator`;
    $('details-button').hidden = !state.editing;
    templateButton.hidden = !state.editing;
    publishButton.hidden = !state.editing || ev.isTemplate || !['draft', 'published'].includes(ev.status);
    publishButton.className = ev.status === 'published' ? 'secondary' : '';
    publishButton.textContent = ev.status === 'published' ? t('setlist.unpublish') : t('setlist.publish');
    const dirty = isDirty();
    publishButton.disabled = dirty;
    templateButton.disabled = dirty;
  }

  function renderSaveBar() {
    const bar = $('save-bar');
    bar.hidden = !state.editing;
    if (!state.editing) return;
    const dirty = isDirty();
    bar.classList.toggle('dirty', dirty);
    saveButton.disabled = !dirty || state.saving;
    saveButton.textContent = state.saving ? t('setlist.saving') : t('setlist.save');
    saveState.className = `save-state${state.lastSaveError ? ' error' : ''}`;
    saveState.textContent = state.lastSaveError
      || (dirty ? `${t('setlist.unsaved')}. ${t('setlist.saveFirst')}` : (state.justSaved ? t('setlist.saved') : ''));
  }

  // --- setlist ------------------------------------------------------------------

  function toolButton(action, index, symbol, label, disabled) {
    return el('button', {
      type: 'button',
      class: 'secondary icon-button',
      'data-action': action,
      'data-index': index,
      'aria-label': label,
      disabled,
      onclick: () => onTool(action, index),
    }, el('span', { 'aria-hidden': 'true', text: symbol }));
  }

  function renderItems() {
    const count = state.items.length;
    $('setlist-empty').hidden = count > 0;
    $('reorder-hint').hidden = !state.editing || count < 2;
    itemsList.replaceChildren(...state.items.map((item, i) => {
      const title = itemTitle(item);
      const selected = i === state.selected;
      const main = el('button', {
        type: 'button',
        class: 'item-main',
        'aria-expanded': String(selected),
        'aria-controls': 'detail',
        'data-index': i,
        onclick: () => select(selected ? -1 : i),
        onkeydown: (event) => onItemKey(event, i),
      },
      el('span', { class: 'item-number', 'aria-hidden': 'true', text: String(i + 1) }),
      el('span', { class: 'item-text' },
        el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
        el('span', { class: `item-title${item.songDeleted ? ' deleted' : ''}`, text: title }),
        itemSubline(item) ? el('span', { class: 'item-sub', text: itemSubline(item) }) : null));
      const tools = state.editing
        ? el('span', { class: 'item-tools' },
          toolButton('up', i, '↑', t('setlist.moveUp', { title }), i === 0),
          toolButton('down', i, '↓', t('setlist.moveDown', { title }), i === count - 1),
          toolButton('remove', i, '✕', t('setlist.remove', { title }), false))
        : null;
      return el('li', { class: `setlist-item${selected ? ' selected' : ''}` }, el('div', { class: 'item-row' }, main, tools));
    }));
    placeDetail();
  }

  // Narrow screens: the detail opens under the selected item. Wide: in the side pane.
  function placeDetail() {
    const li = state.selected >= 0 ? itemsList.children[state.selected] : null;
    if (!wide.matches && li) li.append(detail);
    else if (detail.parentElement !== detailHome) detailHome.append(detail);
  }

  function renderAll() {
    renderHeader();
    renderItems();
    renderDetail();
    renderSaveBar();
  }

  function changed() {
    state.justSaved = false;
    state.lastSaveError = null;
    renderHeader();
    renderSaveBar();
    scheduleDraft();
  }

  function select(index, focusDetail) {
    if (index !== state.selected) selectedChip = -1;
    state.selected = index;
    renderItems();
    renderDetail();
    if (focusDetail) {
      const first = detail.querySelector('input, textarea, select, a');
      if (first) first.focus();
    }
  }

  function focusItem(index, action) {
    const target = action && itemsList.querySelector(`[data-action="${action}"][data-index="${index}"]`);
    if (target && !target.disabled) target.focus();
    else itemsList.querySelector(`.item-main[data-index="${index}"]`)?.focus();
  }

  function move(from, to, action) {
    if (to < 0 || to >= state.items.length) return;
    const [item] = state.items.splice(from, 1);
    state.items.splice(to, 0, item);
    if (state.selected === from) state.selected = to;
    else if (state.selected === to) state.selected = from;
    renderItems();
    renderDetail();
    changed();
    focusItem(to, action);
  }

  function onTool(action, index) {
    if (action === 'up') move(index, index - 1, 'up');
    else if (action === 'down') move(index, index + 1, 'down');
    else if (action === 'remove') {
      state.items.splice(index, 1);
      if (state.selected === index) state.selected = -1;
      else if (state.selected > index) state.selected -= 1;
      renderItems();
      renderDetail();
      changed();
      if (state.items.length) focusItem(Math.min(index, state.items.length - 1), 'remove');
      else $('add-bar').querySelector('button').focus();
    }
  }

  function onItemKey(event, index) {
    if (!state.editing || !event.altKey) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(index, index - 1, null);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(index, index + 1, null);
    }
  }

  function addItem(type) {
    state.items.push({ key: nextKey++, type, songId: null, title: '', body: '', reference: '', url: '', durationMin: null, song: null, songDeleted: false });
    changed();
    select(state.items.length - 1, true);
  }

  // --- detail pane ----------------------------------------------------------------

  function field(id, label, control, hint) {
    return el('div', { class: 'field' },
      el('label', { for: id, text: label }),
      control,
      hint ? el('span', { class: 'hint', id: `${id}-hint`, text: hint }) : null);
  }

  function bind(item, key, control, after) {
    control.addEventListener('input', () => {
      item[key] = control.value;
      changed();
      // Keep the list line in step without rebuilding the form being typed in.
      const row = itemsList.children[state.selected];
      if (row) {
        row.querySelector('.item-title').textContent = itemTitle(item);
        const sub = row.querySelector('.item-sub');
        if (sub) sub.textContent = itemSubline(item);
      }
      const heading = detail.querySelector('.detail-head h3');
      if (heading) heading.textContent = itemTitle(item);
      if (after) after();
    });
    return control;
  }

  function input(item, key, id, attrs = {}) {
    return bind(item, key, el('input', { id, value: item[key] ?? '', ...attrs }));
  }

  function textarea(item, key, id, rows) {
    return bind(item, key, el('textarea', { id, rows: String(rows), maxlength: '5000', value: item[key] || '' }));
  }

  function durationField(item) {
    return field('it-duration', t('setlist.durationLabel'),
      input(item, 'durationMin', 'it-duration', { type: 'number', min: '0', max: '600', step: '1', inputmode: 'numeric' }));
  }

  function readOnlyText(label, value) {
    return value ? el('div', { class: 'ro-field' }, el('span', { class: 'ro-label', text: label }), el('p', { class: 'lyrics', text: value })) : null;
  }

  // --- song options (key, arrangement, note, reference) -----------------------------

  const { keyAfter, transposeContent } = window.CHORDS;
  const { sectionCodes, sectionLabels, codeIndex, defaultArrangement } = window.SECTIONS;
  let selectedChip = -1;

  function offsetText(n) {
    return n > 0 ? `+${n}` : String(n);
  }

  // A song without a key can still be transposed: show the semitone offset instead.
  function semitoneText(transpose) {
    return t(Math.abs(transpose) === 1 ? 'options.keyNoKeyOne' : 'options.keyNoKey', { offset: offsetText(transpose) });
  }

  function songKeySubline(item) {
    if (!item.song) return null;
    const transpose = Number(item.transpose) || 0;
    if (!item.song.key) return transpose ? semitoneText(transpose) : null;
    const key = keyAfter(item.song.key, transpose);
    const shown = window.NOTATION.chord(key);
    return transpose ? t('options.songKeyShifted', { key: shown, offset: offsetText(transpose) }) : t('options.songKeyShort', { key: shown });
  }

  function arrangementCodes(item, song) {
    return Array.isArray(item.arrangementCodes) ? item.arrangementCodes : defaultArrangement(song);
  }

  // Re-render the detail after an option change, keeping focus on the control used.
  function optionChanged(item) {
    const focusedId = document.activeElement && document.activeElement.id;
    changed();
    const row = itemsList.children[state.selected];
    const sub = row && row.querySelector('.item-sub');
    if (sub) sub.textContent = itemSubline(item);
    renderDetail();
    const again = focusedId && $(focusedId);
    if (again && !again.disabled) again.focus();
  }

  function keyBlock(item, song) {
    const transpose = Number(item.transpose) || 0;
    const display = song.song_key
      ? (transpose
        ? t('options.keyDisplay', { key: window.NOTATION.chord(keyAfter(song.song_key, transpose)), original: window.NOTATION.chord(song.song_key), offset: offsetText(transpose) })
        : t('options.keyOriginalOnly', { key: window.NOTATION.chord(song.song_key) }))
      : (transpose ? semitoneText(transpose) : t('options.keyNoKeyNone'));
    const setTranspose = (value) => {
      item.transpose = value;
      optionChanged(item);
    };
    if (!state.editing) {
      return el('div', { class: 'option-block' },
        el('span', { class: 'ro-label', text: t('options.keyLabel') }),
        el('p', { class: 'key-display', text: display }));
    }
    return el('div', { class: 'option-block', role: 'group', 'aria-labelledby': 'opt-key-label' },
      el('span', { class: 'ro-label', id: 'opt-key-label', text: t('options.keyLabel') }),
      el('div', { class: 'key-row' },
        el('button', { type: 'button', class: 'secondary icon-button', id: 'opt-key-down', 'aria-label': t('options.keyDown'), disabled: transpose <= -11, onclick: () => setTranspose(transpose - 1) }, el('span', { 'aria-hidden': 'true', text: '−' })),
        el('output', { class: 'key-display', id: 'opt-key-display', 'aria-live': 'polite', text: display }),
        el('button', { type: 'button', class: 'secondary icon-button', id: 'opt-key-up', 'aria-label': t('options.keyUp'), disabled: transpose >= 11, onclick: () => setTranspose(transpose + 1) }, el('span', { 'aria-hidden': 'true', text: '+' }))),
      el('button', { type: 'button', class: 'secondary', id: 'opt-key-reset', disabled: transpose === 0, onclick: () => setTranspose(0), text: t('options.keyReset') }));
  }

  function arrangementBlock(item, song) {
    const codes = arrangementCodes(item, song);
    const canonical = sectionCodes(song.sections);
    const labels = sectionLabels(song.sections, t);
    const labelOf = (code) => labels[canonical.indexOf(code)] || code;
    const isDefault = item.arrangementIsDefault !== false;
    if (selectedChip >= codes.length) selectedChip = -1;

    const setCodes = (next, chip) => {
      item.arrangementCodes = next;
      item.arrangementIsDefault = false;
      item.arrangementWarnings = [];
      selectedChip = chip;
      optionChanged(item);
    };
    const moveChip = (delta) => {
      const next = codes.slice();
      const to = selectedChip + delta;
      [next[selectedChip], next[to]] = [next[to], next[selectedChip]];
      setCodes(next, to);
    };

    const chips = el('ol', { class: 'chip-strip', 'aria-label': t('options.arrangementLabel') },
      codes.map((code, i) => el('li', null, state.editing
        ? el('button', {
          type: 'button',
          class: 'chip',
          id: `opt-chip-${i}`,
          'aria-pressed': String(i === selectedChip),
          onclick: () => {
            selectedChip = i === selectedChip ? -1 : i;
            optionChanged(item);
          },
        }, el('span', { class: 'chip-code', text: code }), el('span', { text: labelOf(code) }))
        : el('span', { class: 'chip' }, el('span', { class: 'chip-code', text: code }), el('span', { text: labelOf(code) })))));

    const parts = [
      el('span', { class: 'ro-label', text: `${t('options.arrangementLabel')} · ${t(isDefault ? 'options.arrangementIsDefault' : 'options.arrangementIsCustom')}` }),
      (item.arrangementWarnings || []).length
        ? el('p', { class: 'message error', text: t('options.arrangementWarning', { codes: item.arrangementWarnings.join(', ') }) })
        : null,
      codes.length ? chips : el('p', { class: 'muted', text: t('options.arrangementEmpty') }),
    ];
    if (state.editing) {
      const chipLabel = selectedChip >= 0 ? labelOf(codes[selectedChip]) : '';
      const add = el('select', {
        id: 'opt-add-section',
        'aria-label': t('options.addSectionLabel'),
        onchange: (event) => {
          if (!event.target.value) return;
          setCodes([...codes, event.target.value], codes.length);
        },
      }, el('option', { value: '', text: t('options.addSection') }),
      canonical.map((code, i) => el('option', { value: code, text: `${labels[i]} (${code})` })));
      parts.push(
        codes.length ? el('p', { class: 'hint', text: t('options.chipHint') }) : null,
        el('div', { class: 'chip-tools' },
          el('button', { type: 'button', class: 'secondary', id: 'opt-chip-left', disabled: selectedChip <= 0, 'aria-label': chipLabel ? t('options.moveLeftLabel', { label: chipLabel }) : null, onclick: () => moveChip(-1) }, '← ', t('options.moveLeft')),
          el('button', { type: 'button', class: 'secondary', id: 'opt-chip-right', disabled: selectedChip < 0 || selectedChip >= codes.length - 1, 'aria-label': chipLabel ? t('options.moveRightLabel', { label: chipLabel }) : null, onclick: () => moveChip(1) }, t('options.moveRight'), ' →'),
          el('button', { type: 'button', class: 'secondary', id: 'opt-chip-remove', disabled: selectedChip < 0, 'aria-label': chipLabel ? t('options.removeChipLabel', { label: chipLabel }) : null, onclick: () => setCodes(codes.filter((c, i) => i !== selectedChip), Math.min(selectedChip, codes.length - 2)) }, '✕ ', t('options.removeChip'))),
        el('div', { class: 'chip-tools' },
          add,
          el('button', {
            type: 'button',
            class: 'secondary',
            id: 'opt-arrangement-reset',
            disabled: isDefault,
            onclick: () => {
              item.arrangementIsDefault = true;
              item.arrangementCodes = defaultArrangement(song);
              item.arrangementWarnings = [];
              selectedChip = -1;
              optionChanged(item);
            },
            text: t('options.resetArrangement'),
          })));
    }
    return el('div', { class: 'option-block' }, parts);
  }

  // Sections in arrangement order (first appearance), chords transposed, labels from the whole song.
  function previewBlock(item, song) {
    const codes = arrangementCodes(item, song);
    const seen = new Set();
    const indexes = [];
    for (const code of codes.length ? codes : sectionCodes(song.sections)) {
      const index = codeIndex(code, song.sections);
      if (index >= 0 && !seen.has(index)) {
        seen.add(index);
        indexes.push(index);
      }
    }
    const labels = sectionLabels(song.sections, t);
    const key = keyAfter(song.song_key, item.transpose);
    const sections = indexes.map((i) => ({ ...song.sections[i], content: transposeContent(song.sections[i].content, item.transpose, key) }));
    return el('div', { class: 'detail-sections' },
      el('div', { class: 'preview-head' }, el('span', { class: 'ro-label', text: t('options.previewHeading') }), window.NOTATION.createSwitch()),
      window.SONG_RENDER.sectionsView(sections, { headingLevel: 4, labels: indexes.map((i) => labels[i]) }));
  }

  function songDetail(item) {
    const parts = [];
    if (item.songDeleted || !item.songId) {
      parts.push(el('p', { class: 'message error', text: t('setlist.songDeletedHint') }));
      if (state.editing) parts.push(durationField(item));
      return parts;
    }
    const cached = state.songCache.get(item.songId);
    if (!cached) {
      state.songCache.set(item.songId, 'loading');
      api(`/api/songs/${item.songId}`).then((res) => {
        state.songCache.set(item.songId, res.ok ? res.body.song : 'error');
        if (state.items[state.selected] === item) renderDetail();
      }).catch(() => state.songCache.set(item.songId, 'error'));
    }
    if (!cached || cached === 'loading') return [el('p', { class: 'muted', text: t('events.loading') })];
    if (cached === 'error') return [el('p', { class: 'message error', text: t('common.networkError') })];

    const song = cached;
    parts.push(keyBlock(item, song), arrangementBlock(item, song));
    if (state.editing) {
      parts.push(
        field('it-team-note', t('options.teamNoteLabel'), bind(item, 'teamNote', el('textarea', { id: 'it-team-note', rows: '2', maxlength: '500', value: item.teamNote || '' }))),
        field('it-reference-url', t('options.referenceUrlLabel'), input(item, 'referenceUrl', 'it-reference-url', { type: 'url', maxlength: '500', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false' })),
        durationField(item));
    } else {
      if (item.teamNote) parts.push(el('p', { class: 'team-note', text: item.teamNote }));
      if (item.referenceUrl) parts.push(el('p', null, el('a', { class: 'button secondary', href: item.referenceUrl, target: '_blank', rel: 'noopener noreferrer', text: t('options.listenReference') })));
    }
    parts.push(el('p', null, el('a', { class: 'button secondary', href: `/songs/${item.songId}`, text: t('setlist.openSong') })), previewBlock(item, song));
    return parts;
  }

  function editFields(item) {
    const typeSelect = item.type === 'sermon' || item.type === 'other'
      ? field('it-type', t('setlist.typeLabel'), bind(item, 'type', (() => {
        const s = el('select', { id: 'it-type' },
          ['sermon', 'other'].map((type) => el('option', { value: type, text: t(`setlist.types.${type}`) })));
        s.value = item.type;
        return s;
      })(), () => {
        const row = itemsList.children[state.selected];
        const badges = [row && row.querySelector('.item-main .type-badge'), detail.querySelector('.detail-head .type-badge')];
        for (const badge of badges.filter(Boolean)) {
          badge.className = `type-badge type-${item.type}`;
          badge.textContent = t(`setlist.types.${item.type}`);
        }
      }))
      : null;
    switch (item.type) {
      case 'verse':
        return [
          field('it-reference', t('setlist.referenceLabel'), input(item, 'reference', 'it-reference', { type: 'text', maxlength: '100', 'aria-describedby': 'it-reference-hint' }), t('setlist.referenceHint')),
          field('it-body', t('setlist.verseTextLabel'), textarea(item, 'body', 'it-body', 5)),
          durationField(item),
        ];
      case 'video':
        return [
          field('it-title', t('setlist.titleLabel'), input(item, 'title', 'it-title', { type: 'text', maxlength: '200' })),
          ...videoSourceFields(item),
          durationField(item),
        ];
      default:
        return [
          typeSelect,
          field('it-title', t('setlist.titleLabel'), input(item, 'title', 'it-title', { type: 'text', maxlength: '200' })),
          field('it-body', t('setlist.bodyLabel'), textarea(item, 'body', 'it-body', 4)),
          durationField(item),
        ];
    }
  }

  // A video item plays a media library entry, or a link that can be saved into the library.
  function videoSourceFields(item) {
    const library = state.media || [];
    const select = el('select', {
      id: 'it-media',
      onchange: () => {
        const chosen = library.find((m) => String(m.id) === select.value);
        item.mediaId = chosen ? chosen.id : null;
        item.media = chosen ? { id: chosen.id, title: chosen.title, kind: chosen.kind } : null;
        if (chosen && !item.title) item.title = chosen.title;
        changed();
        renderAll();
      },
    }, el('option', { value: '', text: t('setlist.mediaNone') }),
    library.map((m) => el('option', { value: String(m.id), text: m.title })));
    select.value = item.mediaId ? String(item.mediaId) : '';
    const parts = [field('it-media', t('setlist.mediaLabel'), select, library.length ? null : t('setlist.mediaEmptyHint'))];
    if (!item.mediaId) {
      const message = el('p', { class: 'message', role: 'status' });
      parts.push(field('it-url', t('setlist.urlLabel'), input(item, 'url', 'it-url', { type: 'url', maxlength: '500', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false' }), t('setlist.videoUrlHint')));
      // Saving into the media library: owner and leader (the operator keeps the link).
      if (canEditLibrary(state.me)) parts.push(el('div', { class: 'field' },
        el('button', {
          type: 'button',
          class: 'secondary',
          text: t('setlist.mediaSaveUrl'),
          onclick: async () => {
            const res = await api('/api/media/url', { method: 'POST', body: { title: item.title || item.url, url: item.url } });
            if (!res.ok) {
              message.className = 'message error';
              message.textContent = res.body.error || t('common.networkError');
              return;
            }
            state.media = [...library, res.body.media];
            item.mediaId = res.body.media.id;
            item.media = { id: res.body.media.id, title: res.body.media.title, kind: res.body.media.kind };
            item.url = '';
            changed();
            renderAll();
          },
        }),
        message));
    }
    return parts;
  }

  function viewFields(item) {
    const duration = item.durationMin ? el('p', { class: 'muted', text: t('setlist.minutes', { n: item.durationMin }) }) : null;
    switch (item.type) {
      case 'verse':
        return [readOnlyText(t('setlist.referenceLabel'), item.reference), readOnlyText(t('setlist.verseTextLabel'), item.body), duration];
      case 'video':
        if (item.media) return [readOnlyText(t('setlist.mediaLabel'), item.media.title), duration];
        return [item.url ? el('p', null, el('a', { class: 'button secondary video-link', href: item.url, target: '_blank', rel: 'noopener noreferrer', text: item.url })) : null, duration];
      default:
        return [readOnlyText(t('setlist.bodyLabel'), item.body), duration];
    }
  }

  function renderDetail() {
    const item = state.items[state.selected];
    if (!item) {
      detail.replaceChildren(el('p', { class: 'muted detail-empty', text: state.items.length ? t('setlist.selectHint') : '' }));
      detail.classList.add('is-empty');
      placeDetail();
      return;
    }
    detail.classList.remove('is-empty');
    detail.replaceChildren(
      el('div', { class: 'detail-head' },
        el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
        el('h3', { text: itemTitle(item) })),
      ...(item.type === 'song' ? songDetail(item) : (state.editing ? editFields(item) : viewFields(item))).filter(Boolean),
    );
    placeDetail();
  }

  // --- saving, publishing, templates, delete --------------------------------------

  async function save() {
    state.saving = true;
    state.lastSaveError = null;
    renderSaveBar();
    try {
      const res = await api(`/api/events/${state.event.id}/items`, { method: 'PUT', body: { items: payload(state.items) } });
      if (res.ok) {
        applyEvent(res.body, true);
        state.justSaved = true;
        removeDraft();
      } else {
        state.lastSaveError = res.body.error || t('common.networkError');
      }
    } catch (err) {
      state.lastSaveError = t('common.networkError');
    } finally {
      state.saving = false;
      renderSaveBar();
      renderHeader();
    }
  }

  // Server data -> state (keeps the selection by position after a save).
  function applyEvent(body, keepSelection) {
    state.event = body.event;
    state.today = body.today;
    state.items = body.items.map(fromServer);
    state.saved = JSON.stringify(payload(state.items));
    if (!keepSelection || state.selected >= state.items.length) state.selected = -1;
    renderAll();
  }

  function showAction(text, link) {
    actionMessage.replaceChildren(text, link ? ' ' : '', link || '');
  }

  publishButton.addEventListener('click', async () => {
    const action = state.event.status === 'published' ? 'unpublish' : 'publish';
    publishButton.disabled = true;
    try {
      const res = await api(`/api/events/${state.event.id}/${action}`, { method: 'POST' });
      if (res.ok) {
        state.event = res.body.event;
        showAction('');
      } else {
        showAction(res.body.error || t('common.networkError'));
      }
    } catch (err) {
      showAction(t('common.networkError'));
    }
    renderHeader();
  });

  function wireDialog(dialog) {
    dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  }
  ['details-dialog', 'template-dialog'].forEach((id) => wireDialog($(id)));

  $('details-button').addEventListener('click', () => {
    const ev = state.event;
    $('d-name').value = ev.name;
    $('d-date').value = ev.eventDate;
    $('d-time').value = ev.startTime || '';
    $('d-notes').value = ev.notes || '';
    $('details-message').textContent = '';
    $('details-dialog').showModal();
  });

  $('details-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const res = await api(`/api/events/${state.event.id}`, {
        method: 'PUT',
        body: { name: $('d-name').value, eventDate: $('d-date').value, startTime: $('d-time').value, notes: $('d-notes').value },
      });
      if (!res.ok) {
        $('details-message').textContent = res.body.error || t('common.networkError');
        return;
      }
      state.event = res.body.event;
      $('details-dialog').close();
      renderHeader();
    } catch (err) {
      $('details-message').textContent = t('common.networkError');
    }
  });

  templateButton.addEventListener('click', () => {
    $('t-name').value = state.event.name;
    $('template-message').textContent = '';
    $('template-dialog').showModal();
    $('t-name').select();
  });

  $('template-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const res = await api(`/api/events/${state.event.id}/save-as-template`, { method: 'POST', body: { name: $('t-name').value } });
      if (res.status !== 201) {
        $('template-message').textContent = res.body.error || t('common.networkError');
        return;
      }
      $('template-dialog').close();
      showAction(t('setlist.templateCreated'), el('a', { href: `/events/${res.body.event.id}/edit`, text: t('setlist.openTemplate') }));
    } catch (err) {
      $('template-message').textContent = t('common.networkError');
    }
  });

  $('delete-button').addEventListener('click', () => {
    $('delete-text').textContent = t('setlist.deleteConfirm', { name: state.event.name });
    $('delete-message').textContent = '';
    $('delete-dialog').showModal();
  });

  $('confirm-delete').addEventListener('click', async () => {
    try {
      const res = await api(`/api/events/${state.event.id}`, { method: 'DELETE' });
      if (res.ok) {
        state.saved = JSON.stringify(payload(state.items)); // nothing left to warn about
        state.items = [];
        state.editing = false;
        window.location.assign('/events');
        return;
      }
      $('delete-message').textContent = res.body.error || t('common.networkError');
    } catch (err) {
      $('delete-message').textContent = t('common.networkError');
    }
  });

  saveButton.addEventListener('click', save);

  // Ctrl/Cmd+S saves while editing.
  document.addEventListener('keydown', (event) => {
    if (state.editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (isDirty() && !state.saving) save();
    }
  });

  // --- unsaved-changes guard ----------------------------------------------------------

  const DRAFT_DELAY_MS = 500;
  const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const leaveDialog = $('leave-dialog');
  let draftTimer = null;
  let pendingDraft = null;
  let pendingHref = null;
  let leaving = false; // true once we navigate away on purpose

  function draftKey() {
    return `wa_setlist_draft:${state.me.user.id}:${state.event.id}`;
  }

  // localStorage can be unavailable (private mode) or full: the guard then just does less.
  function storage(fn) {
    try {
      return fn(window.localStorage);
    } catch (err) {
      return null;
    }
  }

  function removeDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (state.event && state.me) storage((s) => s.removeItem(draftKey()));
  }

  function writeDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!state.editing || !state.event) return;
    if (!isDirty()) {
      removeDraft();
      return;
    }
    const items = state.items.map(({ key, ...rest }) => rest);
    storage((s) => s.setItem(draftKey(), JSON.stringify({ savedAt: Date.now(), eventUpdatedAt: state.event.updatedAt, items })));
  }

  function scheduleDraft() {
    if (!state.editing) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(writeDraft, DRAFT_DELAY_MS);
  }

  // Leaving by swipe/back on iOS may not wait for the debounce: write it now.
  function flushDraft() {
    if (draftTimer) writeDraft();
  }
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDraft();
  });

  // A backup is offered when it is newer than the last save of the event and at most
  // 7 days old; anything else is dropped.
  function checkDraft() {
    const draft = storage((s) => JSON.parse(s.getItem(draftKey()) || 'null'));
    if (!draft) return;
    const valid = Array.isArray(draft.items) && Number.isFinite(draft.savedAt)
      && Date.now() - draft.savedAt <= DRAFT_MAX_AGE_MS && draft.savedAt > state.event.updatedAt;
    if (!valid) {
      removeDraft();
      return;
    }
    pendingDraft = draft;
    renderDraftBanner();
  }

  function renderDraftBanner() {
    $('draft-banner').hidden = !pendingDraft;
    if (!pendingDraft) return;
    const locale = window.I18N.lang === 'en' ? 'en-GB' : 'ro-RO';
    const time = new Date(pendingDraft.savedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
    $('draft-time').textContent = t('setlist.draftTime', { time });
  }

  $('draft-restore').addEventListener('click', () => {
    state.items = pendingDraft.items.map(fromServer);
    state.selected = -1;
    pendingDraft = null;
    renderDraftBanner();
    renderAll();
    changed();
    itemsList.querySelector('.item-main')?.focus();
  });

  $('draft-discard').addEventListener('click', () => {
    pendingDraft = null;
    removeDraft();
    renderDraftBanner();
  });

  function leaveTo(href) {
    leaving = true;
    window.location.assign(href);
  }

  // Internal links (nav, back, song links...) ask first while there are unsaved changes.
  document.addEventListener('click', (event) => {
    if (!isDirty() || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    event.preventDefault();
    pendingHref = url.href;
    $('leave-message').textContent = '';
    leaveDialog.showModal();
    $('leave-stay').focus();
  }, true);

  $('leave-save').addEventListener('click', async () => {
    $('leave-save').disabled = true;
    await save();
    $('leave-save').disabled = false;
    if (!isDirty() && !state.lastSaveError) leaveTo(pendingHref);
    else $('leave-message').textContent = state.lastSaveError || t('common.networkError');
  });

  $('leave-discard').addEventListener('click', () => {
    removeDraft();
    leaveTo(pendingHref);
  });

  // Desktop browsers still get the native prompt (reloads, closing the tab, typed URLs).
  window.addEventListener('beforeunload', (event) => {
    if (leaving || !isDirty()) return;
    flushDraft();
    event.preventDefault();
    event.returnValue = '';
  });

  // --- song picker ------------------------------------------------------------------

  const songDialog = $('song-dialog');
  const songQuery = $('song-q');
  const songResults = $('song-results');
  const songStatus = $('song-status');
  let pickTimer = null;
  let pickRequest = 0;
  let pickData = null;

  function renderPick() {
    if (!pickData) return;
    songResults.replaceChildren(...pickData.songs.map((song) => el('li', null,
      el('button', {
        type: 'button',
        class: 'pick-button',
        onclick: () => {
          state.items.push({
            key: nextKey++, type: 'song', songId: song.id, title: song.title, body: '', reference: '', url: '',
            durationMin: null, song: { id: song.id, title: song.title, key: song.song_key, sectionCount: song.section_count }, songDeleted: false,
            transpose: 0, arrangementIsDefault: true, arrangementCodes: null, arrangementWarnings: [], teamNote: '', referenceUrl: '',
          });
          songDialog.close();
          changed();
          renderItems();
          renderDetail();
          focusItem(state.items.length - 1, null);
        },
      },
      el('span', { class: 'song-title', text: song.title }),
      el('span', { class: 'song-meta', text: [song.song_key ? t('library.key', { key: window.NOTATION.chord(song.song_key) }) : null, song.author].filter(Boolean).join(' · ') }),
      el('span', { class: 'song-hint', text: lastSungText(song.lastSung) })))));
    songStatus.textContent = pickData.songs.length ? '' : t('setlist.pickNoResults');
  }

  async function searchSongs() {
    const id = ++pickRequest;
    const q = songQuery.value.trim();
    try {
      const res = await api(`/api/songs?${new URLSearchParams({ q, withHistory: '1' })}`);
      if (id !== pickRequest) return;
      if (!res.ok) {
        songStatus.textContent = res.body.error || t('common.networkError');
        return;
      }
      pickData = res.body;
      if (res.body.today) state.today = res.body.today;
      renderPick();
    } catch (err) {
      if (id === pickRequest) songStatus.textContent = t('common.networkError');
    }
  }

  songQuery.addEventListener('input', () => {
    clearTimeout(pickTimer);
    pickTimer = setTimeout(searchSongs, 250);
  });

  $('add-bar').addEventListener('click', (event) => {
    const button = event.target.closest('[data-add]');
    if (!button) return;
    if (button.dataset.add === 'song') {
      songQuery.value = '';
      pickData = null;
      songResults.replaceChildren();
      songStatus.textContent = t('events.loading');
      songDialog.showModal();
      songQuery.focus();
      searchSongs();
    } else {
      addItem(button.dataset.add);
    }
  });

  // --- start ------------------------------------------------------------------------

  wide.addEventListener('change', placeDetail);

  // Chord notation switched (here or on another switch): re-render in place.
  document.addEventListener('notation:change', () => {
    if (!state.event) return;
    // The switch in the preview is re-created: keep the keyboard focus on it.
    const focused = document.activeElement && document.activeElement.closest('.notation-switch') ? document.activeElement.dataset.value : null;
    renderAll();
    const again = focused && document.querySelector(`#detail .notation-switch [data-value="${focused}"]`);
    if (again) again.focus();
  });

  document.addEventListener('i18n:change', () => {
    if (!state.event) return;
    actionMessage.replaceChildren();
    renderAll();
    renderPick();
    renderDraftBanner();
    const focusedId = document.activeElement && document.activeElement.id;
    if (focusedId) $(focusedId)?.focus();
  });

  (async () => {
    const [meRes, eventRes] = await Promise.all([api('/api/auth/me'), api(`/api/events/${eventId}`)]);
    state.me = meRes.body;
    if (!eventRes.ok) {
      status.removeAttribute('data-i18n');
      status.textContent = eventRes.status === 404 ? t('setlist.notFound') : (eventRes.body.error || t('common.networkError'));
      return;
    }
    state.editing = editSegment === 'edit' && canEdit(state.me);
    $('add-bar').hidden = !state.editing;
    $('delete-area').hidden = !state.editing;
    applyEvent(eventRes.body, false);
    if (state.editing) {
      const mediaRes = await api('/api/media');
      state.media = mediaRes.ok ? mediaRes.body.media : [];
    }
    status.hidden = true;
    $('event').hidden = false;
    if (state.editing) checkDraft();
  })().catch(() => {
    status.removeAttribute('data-i18n');
    status.textContent = t('common.networkError');
  });
})();
