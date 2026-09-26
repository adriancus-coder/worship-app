'use strict';

// The song editor as a component: title, key, author, the sections (type, label, text with
// chords in brackets or pasted chord-over-lyrics lines, note; move / remove / add) and the
// live preview in the reader's notation. The /songs/new and /songs/:id/edit page
// (public/song-edit.js) and the live "+ Cântare nouă" sheet (public/live-new-song.js) use
// the SAME component, so a song written during the service is edited exactly like one
// written at home. Saving is the caller's (POST / PUT /api/songs).
//
//   const editor = SONG_EDITOR.create(container, { ids, sectionPrefix, headingLevel, extra })
//     editor.setSong(song)      // { title, author, song_key, sections } (or null: empty)
//     editor.payload()          // what /api/songs takes
//     editor.isDirty()          // changed since setSong / reset
//     editor.reset({ title })   // empty, optionally a prefilled title
//     editor.focusTitle(); editor.onChange(cb); editor.fields (title, author, key)

(function () {
  const { el } = window.PAGE;
  const { t } = window.I18N;
  const { chordsOverLyricsToInline } = window.CHORDS;
  const { SECTION_TYPES, SONG_KEYS, sectionLabels } = window.SECTIONS;

  const emptySection = () => ({ type: 'verse', label: '', content: '', note: '' });

  function create(container, options = {}) {
    const p = options.prefix || 'se';
    const ids = { title: `${p}-title`, author: `${p}-author`, key: `${p}-key`, sections: `${p}-sections-editor`, addSection: `${p}-add-section`, preview: `${p}-preview`, ...(options.ids || {}) };
    const sectionPrefix = options.sectionPrefix || `${p}-section`;
    const h = `h${options.headingLevel || 2}`;
    const state = { sections: [emptySection()], base: '' };
    const listeners = [];
    const changed = () => { for (const cb of listeners) cb(); };

    // --- markup ---
    const titleInput = el('input', { type: 'text', id: ids.title, maxlength: '200', required: true, oninput: changed });
    const authorInput = el('input', { type: 'text', id: ids.author, maxlength: '200', oninput: changed });
    const keySelect = el('select', { id: ids.key, onchange: changed });
    const sectionsBox = el('div', { id: ids.sections, class: 'sections-editor' });
    const addButton = el('button', { type: 'button', id: ids.addSection, class: 'secondary', 'data-icon': 'plus' });
    const preview = el('div', { id: ids.preview });
    const labels = { title: el('label', { for: ids.title }), author: el('label', { for: ids.author }), key: el('label', { for: ids.key }), sections: el(h), preview: el(h, { id: `${ids.preview}-heading` }) };
    container.classList.add('song-editor');
    container.replaceChildren(
      el('div', { class: 'field' }, labels.title, titleInput),
      el('div', { class: 'field' }, labels.author, authorInput),
      el('div', { class: 'field' }, labels.key, keySelect),
      options.extra || '',
      labels.sections,
      sectionsBox,
      addButton,
      el('section', { class: 'editor-preview', 'aria-labelledby': `${ids.preview}-heading` },
        el('div', { class: 'editor-preview-head' }, labels.preview, window.NOTATION.createSwitch()),
        preview));

    function renderKeys() {
      const value = keySelect.value;
      keySelect.replaceChildren(
        el('option', { value: '', text: t('editor.keyNone') }),
        // Shown in the reader's notation (Sol, Lam); the value stays the letter key.
        ...SONG_KEYS.map((key) => el('option', { value: key, text: window.NOTATION.chord(key) })));
      keySelect.value = value;
    }

    function field(id, labelText, control, hint) {
      return el('div', { class: 'field' },
        el('label', { for: id, text: labelText }),
        control,
        hint ? el('span', { class: 'hint', id: `${id}-hint`, text: hint }) : null);
    }

    const rowsFor = (content) => Math.min(16, Math.max(4, String(content).split('\n').length + 1));

    // Updates the computed labels without rebuilding the form (keeps focus while typing).
    function refreshLabels() {
      const names = sectionLabels(state.sections, t);
      sectionsBox.querySelectorAll('.section-editor').forEach((fieldset, i) => {
        fieldset.querySelector('legend').textContent = names[i];
        fieldset.querySelector('[data-action="up"]').setAttribute('aria-label', t('editor.moveUp', { label: names[i] }));
        fieldset.querySelector('[data-action="down"]').setAttribute('aria-label', t('editor.moveDown', { label: names[i] }));
        fieldset.querySelector('[data-action="remove"]').setAttribute('aria-label', t('editor.removeSection', { label: names[i] }));
      });
    }

    function toolButton(action, index, symbol, disabled) {
      return el('button', {
        type: 'button', class: 'secondary icon-button', 'data-action': action, 'data-index': index, disabled,
        onclick: () => onTool(action, index),
      }, el('span', { 'aria-hidden': 'true', text: symbol }));
    }

    function renderSections() {
      schedulePreview(); // sections added, removed or moved
      const count = state.sections.length;
      sectionsBox.replaceChildren(...state.sections.map((section, i) => {
        const id = `${sectionPrefix}-${i}`;
        const typeSelect = el('select', {
          id: `${id}-type`,
          onchange: (event) => { section.type = event.target.value; refreshLabels(); changed(); },
        }, SECTION_TYPES.map((type) => el('option', { value: type, text: t(`songs.sectionTypes.${type}`) })));
        typeSelect.value = section.type;
        const content = el('textarea', {
          id: `${id}-content`, class: 'mono', rows: rowsFor(section.content), spellcheck: 'false', autocapitalize: 'sentences',
          'aria-describedby': `${id}-content-hint`, value: section.content,
          oninput: (event) => { section.content = event.target.value; changed(); },
          // Pasted "chord line above lyric line" text becomes inline ChordPro.
          onblur: (event) => {
            const converted = chordsOverLyricsToInline(event.target.value);
            if (converted !== event.target.value) {
              event.target.value = converted;
              section.content = converted;
              changed();
            }
          },
        });
        return el('fieldset', { class: 'section-editor' },
          el('legend'),
          el('div', { class: 'section-fields' },
            field(`${id}-type`, t('editor.typeLabel'), typeSelect),
            field(`${id}-label`, t('editor.customLabel'), el('input', {
              type: 'text', id: `${id}-label`, maxlength: '60', value: section.label || '',
              oninput: (event) => { section.label = event.target.value; refreshLabels(); changed(); },
            }))),
          field(`${id}-content`, t('editor.contentLabel'), content, t('editor.contentHint')),
          field(`${id}-note`, t('editor.noteLabel'), el('input', {
            type: 'text', id: `${id}-note`, maxlength: '300', value: section.note || '',
            oninput: (event) => { section.note = event.target.value; changed(); },
          })),
          el('div', { class: 'section-tools' },
            toolButton('up', i, '↑', i === 0),
            toolButton('down', i, '↓', i === count - 1),
            toolButton('remove', i, '✕', count === 1)));
      }));
      refreshLabels();
    }

    function focusTool(action, index) {
      const target = sectionsBox.querySelector(`[data-action="${action}"][data-index="${index}"]`);
      if (target && !target.disabled) target.focus();
      else sectionsBox.querySelector(`#${sectionPrefix}-${index}-type`)?.focus();
    }

    function onTool(action, index) {
      const list = state.sections;
      if (action === 'up' && index > 0) {
        [list[index - 1], list[index]] = [list[index], list[index - 1]];
        renderSections();
        focusTool('up', index - 1);
      } else if (action === 'down' && index < list.length - 1) {
        [list[index + 1], list[index]] = [list[index], list[index + 1]];
        renderSections();
        focusTool('down', index + 1);
      } else if (action === 'remove' && list.length > 1) {
        list.splice(index, 1);
        renderSections();
        focusTool('remove', Math.min(index, list.length - 1));
      } else return;
      changed();
    }

    // Live preview of the sections as they will be shown (chords in the reader's notation).
    let previewTimer = null;
    function renderPreview() {
      clearTimeout(previewTimer);
      const sections = state.sections
        .filter((s) => s.content && s.content.trim())
        .map((s) => ({ type: s.type, label: s.label, note: s.note, content: chordsOverLyricsToInline(s.content) }));
      preview.replaceChildren(...(sections.length
        ? window.SONG_RENDER.sectionsView(sections, { headingLevel: (options.headingLevel || 2) + 1 })
        : [el('p', { class: 'muted', text: t('editor.previewEmpty') })]));
    }
    function schedulePreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 200);
    }
    container.addEventListener('input', schedulePreview);
    container.addEventListener('change', schedulePreview);
    addButton.addEventListener('click', () => {
      state.sections.push(emptySection());
      renderSections();
      sectionsBox.querySelector(`#${sectionPrefix}-${state.sections.length - 1}-type`).focus();
      changed();
    });

    function renderTexts() {
      labels.title.textContent = t('editor.titleLabel');
      labels.author.textContent = t('editor.authorLabel');
      labels.key.textContent = t('editor.keyLabel');
      labels.sections.textContent = t('editor.sectionsHeading');
      labels.preview.textContent = t('editor.previewHeading');
      addButton.textContent = t('editor.addSection');
    }

    function render() {
      renderTexts();
      renderKeys();
      renderSections();
      renderPreview();
    }

    function payload() {
      return {
        title: titleInput.value,
        author: authorInput.value,
        song_key: keySelect.value,
        sections: state.sections.map((s) => ({ type: s.type, label: s.label, content: chordsOverLyricsToInline(s.content), note: s.note })),
      };
    }
    const snapshot = () => JSON.stringify(payload());

    function setSong(song) {
      const s = song || {};
      state.sections = s.sections && s.sections.length
        ? s.sections.map((x) => ({ type: x.type || 'verse', label: x.label || '', content: x.content || '', note: x.note || '' }))
        : [emptySection()];
      titleInput.value = s.title || '';
      authorInput.value = s.author || '';
      renderKeys();
      keySelect.value = s.song_key || '';
      render();
      state.base = snapshot();
    }

    document.addEventListener('notation:change', () => { renderKeys(); renderPreview(); });
    document.addEventListener('i18n:change', render);
    setSong(null);

    return {
      setSong,
      payload,
      isDirty: () => snapshot() !== state.base,
      // Marks the current content as the saved state (nothing to lose).
      markClean: () => { state.base = snapshot(); },
      reset(prefill = {}) { setSong({ title: prefill.title || '' }); },
      focusTitle: () => titleInput.focus(),
      onChange: (cb) => listeners.push(cb),
      render,
      fields: { title: titleInput, author: authorInput, key: keySelect },
      // A song is written when it has a title or any text.
      hasText: () => Boolean(titleInput.value.trim() || state.sections.some((s) => s.content.trim())),
    };
  }

  window.SONG_EDITOR = { create };
})();
