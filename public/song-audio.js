'use strict';

// The song's backing track ("negativ", migration 062) on the song page: everyone plays it
// (a native <audio> with controls); those who may edit the song add, replace or remove it
// (POST / DELETE /api/songs/:id/audio, the file streamed as the request body). The
// operator plays the same file from the console (public/operator.js).
//
//   SONG_AUDIO.box(song, canEdit, onSaved) -> element   song.audio: { id, title, src } | null

(function () {
  const ACCEPT = '.mp3,.m4a,.wav,.ogg,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/ogg';
  const MAX_MB = 20;

  function box(song, canEdit, onSaved) {
    const { el, api } = window.PAGE;
    const { t } = window.I18N;
    const root = el('section', { class: 'song-audio', id: 'song-audio', 'aria-labelledby': 'song-audio-label' });
    const message = el('p', { class: 'message', role: 'status', 'aria-live': 'polite' });
    const say = (text, tone) => { message.textContent = text || ''; message.className = `message${tone ? ` ${tone}` : ''}`; };
    const input = el('input', { type: 'file', id: 'song-audio-file', accept: ACCEPT, hidden: true });
    const pick = el('button', { type: 'button', class: 'secondary', id: 'song-audio-add', 'data-icon': 'plus', onclick: () => input.click(), text: t(song.audio ? 'song.audioReplace' : 'song.audioAdd') });
    const remove = el('button', { type: 'button', class: 'secondary', id: 'song-audio-remove', 'data-icon': 'close', text: t('song.audioRemove') });

    async function upload(file) {
      if (!file) return;
      pick.disabled = true;
      remove.disabled = true;
      say(t('song.audioUploading'));
      try {
        const res = await fetch(`/api/songs/${song.id}/audio?title=${encodeURIComponent(`${song.title} – ${t('song.audioLabel').toLowerCase()}`)}`, {
          method: 'POST', credentials: 'same-origin', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { say(body.error || t('common.networkError'), 'error'); return; }
        song.audio = body.audio;
        song.audioMediaId = body.audio ? body.audio.id : null;
        say(t('song.audioSaved'), 'success');
        onSaved(song);
      } catch (err) {
        say(t('common.networkError'), 'error');
      } finally {
        pick.disabled = false;
        remove.disabled = false;
        input.value = '';
      }
    }
    input.addEventListener('change', () => upload(input.files[0]));
    remove.addEventListener('click', async () => {
      if (!window.confirm(t('song.audioRemoveConfirm'))) return;
      remove.disabled = true;
      const res = await api(`/api/songs/${song.id}/audio`, { method: 'DELETE' }).catch(() => ({ ok: false, body: {} }));
      remove.disabled = false;
      if (!res.ok) { say(res.body.error || t('common.networkError'), 'error'); return; }
      song.audio = null;
      song.audioMediaId = null;
      onSaved(song);
    });

    const player = song.audio ? el('audio', { controls: true, preload: 'none', id: 'song-audio-player', src: song.audio.src }) : null;
    root.append(...[
      el('span', { class: 'ro-label', id: 'song-audio-label', text: t('song.audioLabel') }),
      player,
      !song.audio && !canEdit ? el('p', { class: 'muted song-audio-none', text: t('song.audioNone') }) : null,
      canEdit ? el('div', { class: 'song-audio-actions' }, pick, song.audio ? remove : null, input) : null,
      canEdit ? el('p', { class: 'hint', text: t('song.audioHint', { max: MAX_MB }) }) : null,
      message,
    ].filter(Boolean));
    return root;
  }

  window.SONG_AUDIO = { box };
})();
