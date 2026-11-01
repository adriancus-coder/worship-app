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
    const pick = el('button', { type: 'button', class: 'secondary', id: 'song-audio-add', 'data-icon': 'upload', onclick: () => input.click(), text: t(song.audio && song.audio.kind === 'file' ? 'song.audioReplace' : 'song.audioAdd') });
    const remove = el('button', { type: 'button', class: 'secondary', id: 'song-audio-remove', 'data-icon': 'close', text: t('song.audioRemove') });
    // "Link YouTube": a small form in place of the buttons; the embedded player then plays it
    const linkInput = el('input', { type: 'url', id: 'song-audio-url', placeholder: 'https://www.youtube.com/watch?v=…', autocomplete: 'off', inputmode: 'url', 'aria-label': t('song.audioLinkLabel') });
    const linkSave = el('button', { type: 'submit', id: 'song-audio-url-save', 'data-icon': 'check', text: t('song.audioLinkSave') });
    const linkCancel = el('button', { type: 'button', class: 'secondary', id: 'song-audio-url-cancel', text: t('song.audioLinkCancel') });
    const linkForm = el('form', { class: 'song-audio-link', id: 'song-audio-link', hidden: true, novalidate: true }, linkInput, el('div', { class: 'song-audio-actions' }, linkSave, linkCancel));
    const actions = el('div', { class: 'song-audio-actions', id: 'song-audio-actions' });
    const linkButton = el('button', { type: 'button', class: 'secondary', id: 'song-audio-link-button', 'data-icon': 'link', text: t('song.audioLink'), onclick: () => { linkForm.hidden = false; actions.hidden = true; linkInput.value = song.audio && song.audio.kind === 'youtube' ? song.audio.url : ''; linkInput.focus(); } });
    linkCancel.addEventListener('click', () => { linkForm.hidden = true; actions.hidden = false; linkButton.focus(); });
    linkForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      linkSave.disabled = true;
      say('');
      const res = await api(`/api/songs/${song.id}/audio-url`, { method: 'PUT', body: { url: linkInput.value.trim() } }).catch(() => ({ ok: false, body: {} }));
      linkSave.disabled = false;
      if (!res.ok) { say(res.body.error || t('common.networkError'), 'error'); linkInput.focus(); return; }
      song.audio = res.body.audio;
      song.audioMediaId = null;
      song.audioUrl = res.body.audio.url;
      say(t('song.audioLinkSaved'), 'success');
      onSaved(song);
    });

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
        song.audioUrl = null;
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
      song.audioUrl = null;
      onSaved(song);
    });

    const player = !song.audio ? null
      : song.audio.kind === 'youtube' ? youtubeFrame(song.audio.id, 'song-audio-youtube', t('song.audioYoutube'))
        : el('audio', { controls: true, preload: 'none', id: 'song-audio-player', src: song.audio.src });
    actions.append(...[pick, linkButton, song.audio ? remove : null, input].filter(Boolean));
    root.append(...[
      el('span', { class: 'ro-label', id: 'song-audio-label', text: t('song.audioLabel') }),
      player,
      !song.audio && !canEdit ? el('p', { class: 'muted song-audio-none', text: t('song.audioNone') }) : null,
      canEdit ? actions : null,
      canEdit ? linkForm : null,
      canEdit ? el('p', { class: 'hint', text: `${t('song.audioHint', { max: MAX_MB })} ${t('song.audioLinkHint')}` }) : null,
      message,
    ].filter(Boolean));
    return root;
  }

  // The embedded YouTube player (youtube-nocookie.com, allowed by the CSP frame-src) for a
  // backing track given as a link: the song page and the operator console.
  function youtubeFrame(id, elementId, title) {
    const { el } = window.PAGE;
    return el('div', { class: 'audio-youtube', id: elementId },
      el('iframe', { src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1&playsinline=1`, title, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: 'true', loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin' }));
  }

  window.SONG_AUDIO = { box, youtubeFrame };
})();
