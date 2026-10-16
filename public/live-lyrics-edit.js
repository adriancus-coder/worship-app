'use strict';

// "✎ Versuri" on the live page and the operator console: the song on screen, edited now, in
// the SAME section editor as the library (public/song-editor.js; the song's title / author /
// key stay out of sight), in a sheet that never blocks the live controls (a bottom sheet on
// phones, a side panel from 900 px). Two ways to save:
//   "Salvează doar pentru acest eveniment"  the item keeps its own lyrics (the library song is
//                                           untouched); the pages and the projector refresh at
//                                           once (PUT /api/events/:id/items/:itemId/lyrics)
//   "Salvează în bibliotecă"                the library song changes for good (PUT /api/songs/:id,
//                                           the 'library' right); the item's own lyrics go
// "Revino la textul din bibliotecă" (an item with its own lyrics) drops them. Unsaved changes
// are asked about before the sheet closes.
//
//   const sheet = LIVE_LYRICS_EDIT.create({ api, t, el, eventId, canLibrary, onSaved })
//   sheet.open(item)   // a song item of the event (item.id, item.transpose)

(function () {
  function create({ api, t, el, eventId, canLibrary = () => false, onSaved = () => {} }) {
    const state = { item: null, lyrics: null, busy: false };
    const parts = {};
    let dialog = null;
    let editor = null;

    function build() {
      parts.kicker = el('p', { class: 'preview-kicker' });
      parts.heading = el('h2', { id: 'lyrics-heading', tabindex: '-1' });
      parts.closeX = el('button', { type: 'button', class: 'shell-close preview-close-x', id: 'lyrics-close', text: '✕', onclick: () => requestClose() });
      parts.hint = el('p', { class: 'hint lyrics-hint' });
      parts.editorBox = el('div', { id: 'lyrics-editor' });
      parts.message = el('p', { class: 'message', id: 'lyrics-message', role: 'alert' });
      parts.saveEvent = el('button', { type: 'button', id: 'lyrics-save-event', 'data-icon': 'check', onclick: () => saveEvent() });
      parts.saveLibrary = el('button', { type: 'button', class: 'secondary', id: 'lyrics-save-library', 'data-icon': 'import', onclick: () => saveLibrary() });
      parts.restore = el('button', { type: 'button', class: 'secondary', id: 'lyrics-restore', 'data-icon': 'undo', onclick: () => restore() });
      parts.cancel = el('button', { type: 'button', class: 'secondary', id: 'lyrics-cancel', onclick: () => requestClose() });
      parts.confirmText = el('p');
      parts.discard = el('button', { type: 'button', class: 'danger', id: 'lyrics-discard', onclick: () => close(true) });
      parts.keep = el('button', { type: 'button', class: 'secondary', id: 'lyrics-keep', onclick: () => { parts.confirm.hidden = true; } });
      parts.confirm = el('div', { class: 'new-song-confirm', hidden: true }, parts.confirmText, parts.discard, parts.keep);
      dialog = el('dialog', { class: 'preview-dialog new-song-sheet lyrics-sheet', 'aria-labelledby': 'lyrics-heading' },
        el('div', { class: 'preview-dialog-head' }, el('div', { class: 'preview-dialog-title' }, parts.kicker, parts.heading), parts.closeX),
        el('div', { class: 'preview-dialog-body' }, parts.hint, parts.editorBox),
        el('div', { class: 'preview-dialog-foot' }, parts.message,
          el('div', { class: 'form-actions new-song-actions' }, parts.saveEvent, parts.saveLibrary, parts.restore, parts.cancel), parts.confirm));
      // Escape: the same as "Anulează" (asks first when there are changes); a non-modal dialog
      // gets no cancel event, so the key is handled here (not in the page's own handler).
      dialog.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      });
      document.body.append(dialog);
      editor = window.SONG_EDITOR.create(parts.editorBox, { prefix: 'ly', headingLevel: 3 });
      renderTexts();
    }

    function renderTexts() {
      parts.kicker.textContent = t('lyricsEdit.kicker');
      parts.closeX.setAttribute('aria-label', t('online.close'));
      parts.saveEvent.textContent = t('lyricsEdit.saveEvent');
      parts.saveLibrary.textContent = t('lyricsEdit.saveLibrary');
      parts.restore.textContent = t('lyricsEdit.restore');
      parts.cancel.textContent = t('lyricsEdit.cancel');
      parts.confirmText.textContent = t('lyricsEdit.discardAsk');
      parts.discard.textContent = t('lyricsEdit.discardYes');
      parts.keep.textContent = t('lyricsEdit.keep');
      if (state.lyrics) {
        parts.heading.textContent = state.lyrics.title;
        const bits = [t('lyricsEdit.hint')];
        if (state.item && state.item.transpose && state.lyrics.songKey) bits.push(t('lyricsEdit.transposeNote', { key: window.NOTATION.chord(state.lyrics.songKey) }));
        parts.hint.textContent = bits.join(' ');
      }
    }

    function say(text, tone) {
      parts.message.className = `message${tone ? ` ${tone}` : ''}`;
      parts.message.textContent = text || '';
    }

    function setBusy(busy) {
      state.busy = busy;
      for (const b of [parts.saveEvent, parts.saveLibrary, parts.restore]) b.disabled = busy;
    }

    // After a save: the pages reload the song on their own (the live setlist key changed);
    // onSaved lets a page that is not live refresh too.
    function done(text) {
      editor.markClean();
      close(true);
      onSaved(text);
    }

    async function saveEvent() {
      if (state.busy) return;
      say('');
      setBusy(true);
      try {
        const res = await api(`/api/events/${eventId}/items/${state.item.id}/lyrics`, { method: 'PUT', body: { sections: editor.payload().sections } });
        if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
        done(t('lyricsEdit.savedEvent'));
      } catch (err) {
        say(t('common.networkError'), 'error');
      } finally {
        setBusy(false);
      }
    }

    async function saveLibrary() {
      if (state.busy) return;
      say('');
      setBusy(true);
      try {
        const payload = editor.payload(); // the title, author and key as the song has them
        const res = await api(`/api/songs/${state.lyrics.songId}`, { method: 'PUT', body: payload });
        if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
        // the item's own lyrics would hide the library's: they go
        if (state.lyrics.lyricsEdited) await api(`/api/events/${eventId}/items/${state.item.id}/lyrics`, { method: 'DELETE' });
        document.dispatchEvent(new CustomEvent('library:changed'));
        done(t('lyricsEdit.savedLibrary'));
      } catch (err) {
        say(t('common.networkError'), 'error');
      } finally {
        setBusy(false);
      }
    }

    async function restore() {
      if (state.busy) return;
      say('');
      setBusy(true);
      try {
        const res = await api(`/api/events/${eventId}/items/${state.item.id}/lyrics`, { method: 'DELETE' });
        if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
        done(t('lyricsEdit.restored'));
      } catch (err) {
        say(t('common.networkError'), 'error');
      } finally {
        setBusy(false);
      }
    }

    function requestClose() {
      if (editor.isDirty()) {
        parts.confirm.hidden = false;
        parts.discard.focus();
        return;
      }
      close(true);
    }

    function close() {
      parts.confirm.hidden = true;
      say('');
      if (dialog && dialog.open) dialog.close();
    }

    async function open(item) {
      if (!dialog) build();
      if (dialog.open && editor.isDirty() && state.item && state.item.id !== item.id) return; // another song while editing: keep what is typed
      state.item = item;
      parts.confirm.hidden = true;
      say('');
      const res = await api(`/api/events/${eventId}/items/${item.id}/lyrics`).catch(() => ({ ok: false, body: {} }));
      if (!res.ok) { say(res.body.error || t('common.networkError'), 'error'); return; }
      state.lyrics = res.body;
      editor.setSong({ title: res.body.title, author: res.body.author || '', song_key: res.body.songKey || '', sections: res.body.sections });
      parts.saveLibrary.hidden = !canLibrary();
      parts.restore.hidden = !res.body.lyricsEdited;
      renderTexts();
      if (!dialog.open) dialog.show(); // non-modal: the page stays usable
      parts.heading.focus();
    }

    document.addEventListener('i18n:change', () => { if (dialog) renderTexts(); });

    return { open, isOpen: () => Boolean(dialog && dialog.open) };
  }

  window.LIVE_LYRICS_EDIT = { create };
})();
