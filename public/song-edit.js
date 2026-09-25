'use strict';

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const { chordsOverLyricsToInline } = window.CHORDS;
  const { SECTION_TYPES, SONG_KEYS, sectionLabels } = window.SECTIONS;

  const match = window.location.pathname.match(/^\/songs\/(\d+)\/edit$/);
  const songId = match ? match[1] : null;
  const form = document.getElementById('song-form');
  const status = document.getElementById('status');
  const heading = document.getElementById('editor-heading');
  const titleInput = document.getElementById('song-title');
  const authorInput = document.getElementById('song-author');
  const keySelect = document.getElementById('song-key');
  const container = document.getElementById('sections-editor');
  const message = document.getElementById('message');
  const saveButton = document.getElementById('save');
  const cancelLink = document.getElementById('cancel');
  const dangerZone = document.getElementById('danger-zone');
  const deleteDialog = document.getElementById('delete-dialog');
  const deleteText = document.getElementById('delete-dialog-text');
  const deleteMessage = document.getElementById('delete-message');
  const confirmDelete = document.getElementById('confirm-delete');

  const state = { title: '', sections: [{ type: 'verse', label: '', content: '', note: '' }] };
  let lastMessage = null; // { key, vars } re-translates; { text } is cleared on a language switch

  // --- messages -------------------------------------------------------------

  function showMessage(msg) {
    lastMessage = msg;
    const text = msg.key ? t(msg.key, msg.vars) : msg.text;
    const link = msg.existingId
      ? el('a', { href: `/songs/${msg.existingId}`, text: t('editor.openExisting') })
      : null;
    message.replaceChildren(text, link ? ' ' : '', link || '');
  }

  function clearMessage() {
    lastMessage = null;
    message.replaceChildren();
  }

  // --- rendering ------------------------------------------------------------

  function renderKeys() {
    const value = keySelect.value;
    keySelect.replaceChildren(
      el('option', { value: '', text: t('editor.keyNone') }),
      // Shown in the reader's notation (Sol, Lam); the value stays the letter key.
      ...SONG_KEYS.map((key) => el('option', { value: key, text: window.NOTATION.chord(key) })),
    );
    keySelect.value = value;
  }

  function field(id, labelText, control, hint) {
    return el('div', { class: 'field' },
      el('label', { for: id, text: labelText }),
      control,
      hint ? el('span', { class: 'hint', id: `${id}-hint`, text: hint }) : null);
  }

  function rowsFor(content) {
    return Math.min(16, Math.max(4, String(content).split('\n').length + 1));
  }

  // Updates the computed labels without rebuilding the form (keeps focus while typing).
  function refreshLabels() {
    const labels = sectionLabels(state.sections, t);
    container.querySelectorAll('.section-editor').forEach((fieldset, i) => {
      fieldset.querySelector('legend').textContent = labels[i];
      fieldset.querySelector('[data-action="up"]').setAttribute('aria-label', t('editor.moveUp', { label: labels[i] }));
      fieldset.querySelector('[data-action="down"]').setAttribute('aria-label', t('editor.moveDown', { label: labels[i] }));
      fieldset.querySelector('[data-action="remove"]').setAttribute('aria-label', t('editor.removeSection', { label: labels[i] }));
    });
  }

  function toolButton(action, index, symbol, disabled) {
    return el('button', {
      type: 'button',
      class: 'secondary icon-button',
      'data-action': action,
      'data-index': index,
      disabled,
      onclick: () => onTool(action, index),
    }, el('span', { 'aria-hidden': 'true', text: symbol }));
  }

  function renderSections() {
    schedulePreview(); // sections added, removed or moved
    const count = state.sections.length;
    container.replaceChildren(...state.sections.map((section, i) => {
      const id = `section-${i}`;
      const typeSelect = el('select', {
        id: `${id}-type`,
        onchange: (event) => { section.type = event.target.value; refreshLabels(); },
      }, SECTION_TYPES.map((type) => el('option', { value: type, text: t(`songs.sectionTypes.${type}`) })));
      typeSelect.value = section.type;

      const content = el('textarea', {
        id: `${id}-content`,
        class: 'mono',
        rows: rowsFor(section.content),
        spellcheck: 'false',
        autocapitalize: 'sentences',
        'aria-describedby': `${id}-content-hint`,
        value: section.content,
        oninput: (event) => { section.content = event.target.value; },
        // Pasted "chord line above lyric line" text becomes inline ChordPro.
        onblur: (event) => {
          const converted = chordsOverLyricsToInline(event.target.value);
          if (converted !== event.target.value) {
            event.target.value = converted;
            section.content = converted;
          }
        },
      });

      return el('fieldset', { class: 'section-editor' },
        el('legend'),
        el('div', { class: 'section-fields' },
          field(`${id}-type`, t('editor.typeLabel'), typeSelect),
          field(`${id}-label`, t('editor.customLabel'), el('input', {
            type: 'text',
            id: `${id}-label`,
            maxlength: '60',
            value: section.label || '',
            oninput: (event) => { section.label = event.target.value; refreshLabels(); },
          }))),
        field(`${id}-content`, t('editor.contentLabel'), content, t('editor.contentHint')),
        field(`${id}-note`, t('editor.noteLabel'), el('input', {
          type: 'text',
          id: `${id}-note`,
          maxlength: '300',
          value: section.note || '',
          oninput: (event) => { section.note = event.target.value; },
        })),
        el('div', { class: 'section-tools' },
          toolButton('up', i, '↑', i === 0),
          toolButton('down', i, '↓', i === count - 1),
          toolButton('remove', i, '✕', count === 1)));
    }));
    refreshLabels();
  }

  function focusTool(action, index) {
    const target = container.querySelector(`[data-action="${action}"][data-index="${index}"]`);
    if (target && !target.disabled) target.focus();
    else container.querySelector(`#section-${index}-type`)?.focus();
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
    }
  }

  // Live preview of the sections as they will be shown (chords in the reader's notation).
  // A pasted chord-over-lyrics block, even in solfège, is shown as it will be stored.
  const preview = document.getElementById('editor-preview');
  let previewTimer = null;
  function renderPreview() {
    clearTimeout(previewTimer);
    const sections = state.sections
      .filter((s) => s.content && s.content.trim())
      .map((s) => ({ type: s.type, label: s.label, note: s.note, content: chordsOverLyricsToInline(s.content) }));
    preview.replaceChildren(...(sections.length
      ? window.SONG_RENDER.sectionsView(sections, { headingLevel: 3 })
      : [el('p', { class: 'muted', text: t('editor.previewEmpty') })]));
  }
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 200);
  }
  form.addEventListener('input', schedulePreview);
  form.addEventListener('change', schedulePreview);
  document.addEventListener('notation:change', () => {
    renderKeys();
    renderPreview();
  });

  function renderPage() {
    renderKeys();
    renderSections();
    renderPreview();
    if (songId) {
      heading.dataset.i18n = 'editor.headingEdit';
      heading.textContent = t('editor.headingEdit');
      setTitle('editor.pageTitleEdit', { title: state.title });
    }
    if (lastMessage && lastMessage.key) showMessage(lastMessage);
  }

  // --- actions --------------------------------------------------------------

  document.getElementById('add-section').addEventListener('click', () => {
    state.sections.push({ type: 'verse', label: '', content: '', note: '' });
    renderSections();
    container.querySelector(`#section-${state.sections.length - 1}-type`).focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();
    if (!titleInput.value.trim()) {
      showMessage({ key: 'editor.titleRequired' });
      titleInput.focus();
      return;
    }
    const payload = {
      title: titleInput.value,
      author: authorInput.value,
      song_key: keySelect.value,
      sections: state.sections.map((s) => ({
        type: s.type,
        label: s.label,
        content: chordsOverLyricsToInline(s.content),
        note: s.note,
      })),
    };

    saveButton.disabled = true;
    saveButton.textContent = t('editor.saving');
    try {
      const { ok, status: code, body } = await api(songId ? `/api/songs/${songId}` : '/api/songs', {
        method: songId ? 'PUT' : 'POST',
        body: payload,
      });
      if (ok) {
        window.location.assign(`/songs/${body.song.id}`);
        return;
      }
      if (code === 409) showMessage({ text: body.error, existingId: body.existingId });
      else if (body.error) showMessage({ text: body.error });
      else showMessage({ key: 'editor.failed' });
    } catch (err) {
      showMessage({ key: 'common.networkError' });
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = t('editor.save');
    }
  });

  // --- delete (edit page only) ---------------------------------------------

  function renderDeleteText() {
    deleteText.textContent = t('editor.deleteConfirm', { title: state.title });
  }

  document.getElementById('delete-song').addEventListener('click', () => {
    renderDeleteText();
    deleteMessage.textContent = '';
    deleteDialog.showModal();
  });

  confirmDelete.addEventListener('click', async () => {
    confirmDelete.disabled = true;
    try {
      const { ok, body } = await api(`/api/songs/${songId}`, { method: 'DELETE' });
      if (ok) {
        window.location.assign('/library');
        return;
      }
      deleteMessage.textContent = body.error || t('editor.deleteFailed');
    } catch (err) {
      deleteMessage.textContent = t('common.networkError');
    } finally {
      confirmDelete.disabled = false;
    }
  });

  document.addEventListener('i18n:change', () => {
    if (lastMessage && !lastMessage.key) clearMessage();
    renderPage();
    if (songId) renderDeleteText();
    deleteMessage.textContent = '';
  });

  // --- start ----------------------------------------------------------------

  (async () => {
    if (songId) {
      const { ok, status: code, body } = await api(`/api/songs/${songId}`);
      if (!ok) {
        status.textContent = code === 404 ? t('song.notFound') : (body.error || t('common.networkError'));
        return;
      }
      const song = body.song;
      state.title = song.title;
      state.sections = song.sections.map((s) => ({ type: s.type, label: s.label || '', content: s.content, note: s.note || '' }));
      titleInput.value = song.title;
      authorInput.value = song.author || '';
      renderKeys();
      keySelect.value = song.song_key || '';
      cancelLink.href = `/songs/${song.id}`;
      dangerZone.hidden = false;
    }
    renderPage();
    form.hidden = false;
  })().catch(() => {
    status.textContent = t('common.networkError');
  });
})();
