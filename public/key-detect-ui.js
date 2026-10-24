'use strict';

// "Detectează gama": the pop-up on the song page (public/key-detect.js does the estimation).
// From the song's chords when it has any; otherwise (or on request) from a recording the
// user uploads (mp3, m4a, wav) or records with the microphone (20 seconds), analysed here
// in the browser only: the file is never sent anywhere. The result shows the best key,
// two more candidates and the confidence; the user picks one and confirms before it is
// saved (PUT /api/songs/:id { song_key }); a key already set is never replaced without a
// second, explicit confirmation.

(function () {
  const RECORD_SECONDS = 20;
  const CONFIDENCE_KEYS = { sure: 'keyDetect.sure', likely: 'keyDetect.likely', unsure: 'keyDetect.unsure' };

  let dialog = null;
  let state = null; // { song, onSaved, result, source, chosen, confirming, audioOpen, status, error, recording }
  let recorder = null;

  function build() {
    const { el } = window.PAGE;
    dialog = el('dialog', { class: 'key-detect-dialog', id: 'key-detect-dialog', 'aria-labelledby': 'key-detect-title' });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }); // the backdrop
    dialog.addEventListener('close', stopRecording);
    document.body.append(dialog);
  }

  function keyText(key) {
    return window.NOTATION ? window.NOTATION.chord(key) : key;
  }

  function micSupported() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  // --- audio ---------------------------------------------------------------------------

  // An ArrayBuffer of audio -> { samples (mono Float32Array), sampleRate }.
  async function decode(buffer) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('no-audio');
    const context = new Context();
    try {
      const audio = await new Promise((resolve, reject) => {
        const p = context.decodeAudioData(buffer, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
      const channels = audio.numberOfChannels;
      const samples = new Float32Array(audio.length);
      for (let c = 0; c < channels; c += 1) {
        const data = audio.getChannelData(c);
        for (let i = 0; i < data.length; i += 1) samples[i] += data[i] / channels;
      }
      return { samples, sampleRate: audio.sampleRate };
    } finally {
      if (context.close) context.close().catch(() => {});
    }
  }

  async function analyseBuffer(buffer, source) {
    state.status = 'analysing';
    state.error = null;
    render();
    await new Promise((resolve) => setTimeout(resolve, 30)); // paint the status first
    try {
      const { samples, sampleRate } = await decode(buffer);
      const result = window.KEY_DETECT.fromAudio(samples, sampleRate);
      state.status = null;
      if (!result) {
        state.error = 'keyDetect.audioSilent';
      } else {
        state.result = result;
        state.source = source;
        state.chosen = result.key;
        state.confirming = false;
      }
    } catch (err) {
      state.status = null;
      state.error = 'keyDetect.audioUnreadable';
    }
    render();
  }

  async function onFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    input.value = '';
    analyseBuffer(await file.arrayBuffer(), 'file');
  }

  function stopRecording() {
    if (!recorder) return;
    const { media, stream, timer } = recorder;
    recorder = null;
    clearInterval(timer);
    if (media.state !== 'inactive') media.stop();
    else stream.getTracks().forEach((track) => track.stop());
  }

  async function startRecording() {
    if (!micSupported() || recorder) return;
    state.error = null;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      state.error = 'keyDetect.micDenied';
      render();
      return;
    }
    const chunks = [];
    const media = new window.MediaRecorder(stream);
    const startedAt = Date.now();
    media.addEventListener('dataavailable', (event) => { if (event.data && event.data.size) chunks.push(event.data); });
    media.addEventListener('stop', async () => {
      stream.getTracks().forEach((track) => track.stop());
      state.recording = null;
      if (!chunks.length) {
        state.error = 'keyDetect.audioSilent';
        render();
        return;
      }
      analyseBuffer(await new Blob(chunks, { type: media.mimeType }).arrayBuffer(), 'mic');
    });
    const timer = setInterval(() => {
      const left = RECORD_SECONDS - Math.floor((Date.now() - startedAt) / 1000);
      state.recording = Math.max(0, left);
      if (left <= 0) stopRecording();
      else render();
    }, 500);
    recorder = { media, stream, timer };
    state.recording = RECORD_SECONDS;
    media.start();
    render();
  }

  // --- saving --------------------------------------------------------------------------

  async function save() {
    const { api } = window.PAGE;
    const { song, chosen } = state;
    if (!chosen) return;
    if (song.song_key && song.song_key !== chosen && !state.confirming) {
      state.confirming = true; // never over a key already set without a second confirmation
      render();
      return;
    }
    state.status = 'saving';
    state.error = null;
    render();
    const res = await api(`/api/songs/${song.id}`, { method: 'PUT', body: { song_key: chosen } }).catch(() => null);
    state.status = null;
    if (res && res.ok) {
      song.song_key = res.body.song.song_key;
      dialog.close();
      if (state.onSaved) state.onSaved(res.body.song);
      return;
    }
    state.error = (res && res.body && res.body.error) || 'common.networkError';
    state.confirming = false;
    render();
  }

  // --- rendering -----------------------------------------------------------------------

  function audioBlock() {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const { status, recording } = state;
    const busy = status === 'analysing' || recording !== null;
    const input = el('input', { type: 'file', id: 'key-detect-file', class: 'sr-only', accept: 'audio/*,.mp3,.m4a,.wav,.aac,.ogg,.webm', 'aria-label': t('keyDetect.upload') });
    input.addEventListener('change', () => onFile(input));
    return el('div', { class: 'key-detect-audio' },
      el('p', { class: 'muted', text: t(state.result ? 'keyDetect.audioAlso' : 'keyDetect.audioIntro') }),
      el('div', { class: 'form-actions key-detect-audio-actions' },
        el('button', { type: 'button', class: 'secondary', id: 'key-detect-upload', 'data-icon': 'upload', disabled: busy, text: t('keyDetect.upload'), onclick: () => input.click() }),
        micSupported()
          ? (recording !== null
            ? el('button', { type: 'button', class: 'secondary', id: 'key-detect-stop', 'data-icon': 'stop', text: t('keyDetect.stop', { s: recording }), onclick: stopRecording })
            : el('button', { type: 'button', class: 'secondary', id: 'key-detect-record', 'data-icon': 'play', disabled: busy, text: t('keyDetect.record', { s: RECORD_SECONDS }), onclick: startRecording }))
          : null),
      input,
      el('p', { class: 'hint', text: t('keyDetect.local') }));
  }

  function resultBlock() {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const { result, source, chosen, song, confirming, status } = state;
    const candidates = [result.key, ...result.alternatives];
    const from = source === 'chords' ? t('keyDetect.fromChords', { n: result.chords }) : t(source === 'mic' ? 'keyDetect.fromMic' : 'keyDetect.fromFile');
    const replacing = Boolean(song.song_key && song.song_key !== chosen);
    return el('div', { class: 'key-detect-result' },
      el('p', { class: 'muted key-detect-source', text: from }),
      el('p', { class: 'key-detect-best' },
        el('span', { text: `${t('keyDetect.estimated')}: ` }),
        el('strong', { id: 'key-detect-key', text: keyText(result.key) }),
        el('span', { class: `key-detect-confidence is-${result.confidence}`, id: 'key-detect-confidence', text: ` · ${t(CONFIDENCE_KEYS[result.confidence])}` })),
      el('div', { class: 'choice-group key-detect-choices', role: 'group', 'aria-label': t('keyDetect.choose') },
        ...candidates.map((key) => el('button', { type: 'button', 'data-key': key, 'aria-pressed': String(key === chosen), text: keyText(key), onclick: () => { state.chosen = key; state.confirming = false; render(); } }))),
      el('p', { class: 'hint', text: t('keyDetect.chooseHint') }),
      confirming
        ? el('p', { class: 'key-detect-replace', id: 'key-detect-replace', text: t('keyDetect.replaceAsk', { old: keyText(song.song_key), key: keyText(chosen) }) })
        : (replacing ? el('p', { class: 'key-detect-replace', text: t('keyDetect.replaceWarn', { old: keyText(song.song_key) }) }) : null),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', id: 'key-detect-save', 'data-icon': 'check', disabled: status === 'saving', text: confirming ? t('keyDetect.replace') : t('keyDetect.save', { key: keyText(chosen) }), onclick: save }),
        el('button', { type: 'button', class: 'secondary', text: t('keyDetect.cancel'), onclick: () => dialog.close() })));
  }

  function render() {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const { result, status, error, audioOpen, recording } = state;
    const body = [];
    if (result) body.push(resultBlock());
    if (status === 'analysing') body.push(el('p', { class: 'muted key-detect-status', role: 'status', text: t('keyDetect.analysing') }));
    else if (recording !== null) body.push(el('p', { class: 'muted key-detect-status', role: 'status', text: t('keyDetect.recording', { s: recording }) }));
    if (!result || audioOpen) body.push(audioBlock());
    else body.push(el('button', { type: 'button', class: 'secondary key-detect-audio-open', id: 'key-detect-audio-open', text: t('keyDetect.audioOpen'), onclick: () => { state.audioOpen = true; render(); } }));
    dialog.replaceChildren(
      el('div', { class: 'chord-dialog-head' },
        el('h2', { id: 'key-detect-title', text: t('keyDetect.title') }),
        el('button', { type: 'button', class: 'secondary chord-close', 'data-icon': 'close', 'aria-label': t('chordDiagram.close'), onclick: () => dialog.close() })),
      ...body,
      el('p', { class: error ? 'message error' : 'message', role: 'alert', text: error ? t(error) : '' }));
  }

  // Opens the pop-up for a song ({ id, song_key, sections }); onSaved(song) after a save.
  function open(song, { onSaved } = {}) {
    if (!dialog) build();
    const result = window.KEY_DETECT.fromSections(song.sections);
    state = { song, onSaved, result, source: result ? 'chords' : null, chosen: result ? result.key : null, confirming: false, audioOpen: false, status: null, error: null, recording: null };
    render();
    if (!dialog.open) dialog.showModal();
  }

  // The "Detectează gama" button for a key box (public/arrange-sheet.js keyBox).
  function button(song, onSaved) {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    return el('button', { type: 'button', class: 'song-key-change song-key-detect', 'data-icon': 'key', text: t('keyDetect.button'), onclick: () => open(song, { onSaved }) });
  }

  document.addEventListener('i18n:change', () => { if (dialog && dialog.open && state) render(); });
  document.addEventListener('notation:change', () => { if (dialog && dialog.open && state) render(); });

  window.KEY_DETECT_UI = { open, button, RECORD_SECONDS };
})();
