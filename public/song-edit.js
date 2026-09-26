'use strict';

// /songs/new and /songs/:id/edit: the song editor component (public/song-editor.js) with
// the song's default background, save (POST / PUT /api/songs, a duplicate title links to
// the existing song) and, on the edit page, delete.

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;

  const match = window.location.pathname.match(/^\/songs\/(\d+)\/edit$/);
  const songId = match ? match[1] : null;
  const form = document.getElementById('song-form');
  const status = document.getElementById('status');
  const heading = document.getElementById('editor-heading');
  const message = document.getElementById('message');
  const saveButton = document.getElementById('save');
  const cancelLink = document.getElementById('cancel');
  const deleteArea = document.getElementById('delete-area');
  const deleteDialog = document.getElementById('delete-dialog');
  const deleteText = document.getElementById('delete-dialog-text');
  const deleteMessage = document.getElementById('delete-message');
  const confirmDelete = document.getElementById('confirm-delete');

  const state = { title: '' };
  // The song's default background (null: the church default, 'none', a media id); saved
  // through its own route after the song itself. Its field sits inside the editor.
  const background = { saved: null, field: null };
  const backgroundBox = el('div', { id: 'song-background' });

  // The same ids as before the component (tests and styles know them).
  const editor = window.SONG_EDITOR.create(document.getElementById('song-editor'), {
    ids: { title: 'song-title', author: 'song-author', key: 'song-key', sections: 'sections-editor', addSection: 'add-section', preview: 'editor-preview' },
    sectionPrefix: 'section',
    headingLevel: 2,
    extra: backgroundBox,
  });

  function renderBackground() {
    const value = background.field ? background.field.value : background.saved;
    background.field = window.BG_PICKER.field({
      id: 'song-bg', label: t('background.songDefault'), hint: t('background.songDefaultHint'), value, inherit: '…',
    });
    backgroundBox.replaceChildren(background.field.node);
    window.BG_PICKER.inheritedName('song').then((name) => background.field.setInherit(name));
  }
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

  function renderPage() {
    if (songId) {
      heading.dataset.i18n = 'editor.headingEdit';
      heading.textContent = t('editor.headingEdit');
      setTitle('editor.pageTitleEdit', { title: state.title });
    }
    if (lastMessage && lastMessage.key) showMessage(lastMessage);
  }

  // --- save -----------------------------------------------------------------

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();
    if (!editor.fields.title.value.trim()) {
      showMessage({ key: 'editor.titleRequired' });
      editor.focusTitle();
      return;
    }
    saveButton.disabled = true;
    saveButton.textContent = t('editor.saving');
    try {
      const { ok, status: code, body } = await api(songId ? `/api/songs/${songId}` : '/api/songs', {
        method: songId ? 'PUT' : 'POST',
        body: editor.payload(),
      });
      if (ok) {
        const choice = background.field ? background.field.value : background.saved;
        if (choice !== background.saved) {
          const saved = await api(`/api/songs/${body.song.id}/background`, { method: 'PUT', body: { background: choice } });
          if (!saved.ok) {
            showMessage({ text: saved.body.error || t('editor.failed') });
            return;
          }
        }
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
    renderBackground();
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
      editor.setSong(song);
      cancelLink.href = `/songs/${song.id}`;
      deleteArea.hidden = false;
      background.saved = song.background === undefined ? null : song.background;
    }
    renderPage();
    renderBackground();
    form.hidden = false;
  })().catch(() => {
    status.textContent = t('common.networkError');
  });
})();
