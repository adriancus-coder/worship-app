'use strict';

// "+ Cântare nouă" during the service (the operator console's add panel): the SAME song
// editor as /songs/new (public/song-editor.js) in a sheet that never blocks the live
// controls (a non-modal dialog: a bottom sheet on phones, a side panel from 900 px; the
// keys and the buttons of the console keep working). "Salvează · În setlist" (primary) /
// "Salvează · Doar pe proiector" create the library song and add it in one step, like an
// import; a duplicate title (409) shows the existing song with "Adaugă cântarea existentă".
// The text is kept on the device while writing (it survives a reconnect and a reload) and
// closing with unsaved text asks first.
//
//   const sheet = LIVE_NEW_SONG.create({ api, t, el, eventId, add(target, songId) })
//     add(...) -> Promise<{ done } | { error }>: the console's addItem command
//   sheet.open({ title })   // prefilled title (a search with no results)

(function () {
  const DRAFT_MS = 400;

  function create({ api, t, el, eventId, add }) {
    const DRAFT_KEY = `wa_new_song:${eventId}`;
    const state = { busy: false, existing: null, target: null, timer: null };
    const parts = {};
    let dialog = null;
    let editor = null;

    function readDraft() {
      try {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        return null;
      }
    }
    function writeDraft() {
      try {
        if (editor.hasText()) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(editor.payload()));
        else window.localStorage.removeItem(DRAFT_KEY);
      } catch (err) {
        // no storage: the text lives in the page only
      }
    }
    function clearDraft() {
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch (err) {
        // nothing stored
      }
    }

    function build() {
      parts.heading = el('h2', { id: 'new-song-heading', tabindex: '-1' });
      parts.kicker = el('p', { class: 'preview-kicker' });
      parts.closeX = el('button', { type: 'button', class: 'shell-close preview-close-x', id: 'new-song-close', text: '✕', onclick: () => requestClose() });
      parts.editorBox = el('div', { id: 'new-song-editor' });
      parts.message = el('p', { class: 'message', id: 'new-song-message', role: 'alert' });
      parts.setlist = el('button', { type: 'button', id: 'new-song-setlist', 'data-icon': 'plus', onclick: () => save('setlist') });
      parts.projector = el('button', { type: 'button', class: 'secondary', id: 'new-song-projector', 'data-icon': 'projector', onclick: () => save('projector') });
      parts.cancel = el('button', { type: 'button', class: 'secondary', id: 'new-song-cancel', onclick: () => requestClose() });
      parts.confirmText = el('p');
      parts.discard = el('button', { type: 'button', class: 'danger', id: 'new-song-discard', onclick: () => close(true) });
      parts.keep = el('button', { type: 'button', class: 'secondary', id: 'new-song-keep', onclick: () => { parts.confirm.hidden = true; editor.focusTitle(); } });
      parts.confirm = el('div', { class: 'new-song-confirm', hidden: true }, parts.confirmText, parts.discard, parts.keep);
      dialog = el('dialog', { class: 'preview-dialog new-song-sheet', 'aria-labelledby': 'new-song-heading' },
        el('div', { class: 'preview-dialog-head' }, el('div', { class: 'preview-dialog-title' }, parts.kicker, parts.heading), parts.closeX),
        el('div', { class: 'preview-dialog-body' }, parts.editorBox),
        el('div', { class: 'preview-dialog-foot' }, parts.message,
          el('div', { class: 'form-actions new-song-actions' }, parts.setlist, parts.projector, parts.cancel), parts.confirm));
      // Escape: the same as "Anulează" (asks first when there is text). A non-modal dialog
      // gets no cancel event, so the key is handled here (not in the console's own handler).
      dialog.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      });
      document.body.append(dialog);
      editor = window.SONG_EDITOR.create(parts.editorBox, { prefix: 'new', headingLevel: 3 });
      editor.onChange(() => {
        clearTimeout(state.timer);
        state.timer = setTimeout(writeDraft, DRAFT_MS);
        if (state.existing) showMessage(null); // the title may have changed
      });
      renderTexts();
    }

    function renderTexts() {
      parts.kicker.textContent = t('operator.addHeading');
      parts.heading.textContent = t('operator.newSong');
      parts.closeX.setAttribute('aria-label', t('online.close'));
      parts.setlist.textContent = t('operator.newSongSetlist');
      parts.projector.textContent = t('operator.newSongProjector');
      parts.cancel.textContent = t('operator.newSongCancel');
      parts.confirmText.textContent = t('operator.newSongDiscard');
      parts.discard.textContent = t('operator.newSongDiscardYes');
      parts.keep.textContent = t('operator.newSongKeep');
    }

    // msg: null | { text, tone, existingId }
    function showMessage(msg) {
      state.existing = msg && msg.existingId ? msg.existingId : null;
      parts.message.className = `message${msg && msg.tone ? ` ${msg.tone}` : ''}`;
      if (!msg) {
        parts.message.replaceChildren();
        return;
      }
      parts.message.replaceChildren(msg.text, ...(msg.existingId ? [' ',
        el('a', { href: `/songs/${msg.existingId}`, target: '_blank', rel: 'noopener', text: t('editor.openExisting') }), ' ',
        el('button', { type: 'button', class: 'secondary new-song-existing', 'data-icon': 'plus', text: t('operator.newSongExistingAdd'), onclick: () => addExisting() })] : []));
    }

    function setBusy(busy) {
      state.busy = busy;
      for (const b of [parts.setlist, parts.projector]) b.disabled = busy;
    }

    async function save(target) {
      if (state.busy) return;
      showMessage(null);
      if (!editor.fields.title.value.trim()) {
        showMessage({ text: t('editor.titleRequired'), tone: 'error' });
        editor.focusTitle();
        return;
      }
      state.target = target;
      setBusy(true);
      try {
        const res = await api('/api/songs', { method: 'POST', body: editor.payload() });
        if (res.status === 409) return showMessage({ text: res.body.error, tone: 'error', existingId: res.body.existingId });
        if (!res.ok) return showMessage({ text: res.body.error || t('editor.failed'), tone: 'error' });
        document.dispatchEvent(new CustomEvent('library:changed'));
        const out = await add(target, res.body.song.id);
        if (out && out.error) return showMessage({ text: out.error, tone: 'error' });
        editor.markClean();
        clearDraft();
        close(true);
      } catch (err) {
        showMessage({ text: t('common.networkError'), tone: 'error' });
      } finally {
        setBusy(false);
      }
    }

    // A duplicate title: the existing library song goes where the new one was meant to.
    async function addExisting() {
      if (state.busy || !state.existing) return;
      setBusy(true);
      try {
        const out = await add(state.target || 'setlist', state.existing);
        if (out && out.error) return showMessage({ text: out.error, tone: 'error' });
        editor.markClean();
        clearDraft();
        close(true);
      } finally {
        setBusy(false);
      }
    }

    // Any text (typed now or a restored draft) is asked about before it is dropped.
    function requestClose() {
      if (editor.hasText()) {
        parts.confirm.hidden = false;
        parts.discard.focus();
        return;
      }
      close(true);
    }

    function close(discard) {
      if (discard) {
        clearDraft();
        editor.reset();
      }
      parts.confirm.hidden = true;
      showMessage(null);
      if (dialog.open) dialog.close();
    }

    function open({ title = '' } = {}) {
      if (!dialog) build();
      parts.confirm.hidden = true;
      showMessage(null);
      if (!dialog.open) {
        // A draft from before (a reload, a closed tab) comes back unless a title is asked for.
        const draft = title ? null : readDraft();
        if (draft) editor.setSong(draft);
        else if (title || !editor.hasText()) editor.reset({ title });
        dialog.show(); // non-modal: the console stays usable
      }
      editor.focusTitle();
    }

    document.addEventListener('i18n:change', () => { if (dialog) renderTexts(); });

    return { open, isOpen: () => Boolean(dialog && dialog.open) };
  }

  window.LIVE_NEW_SONG = { create };
})();
