'use strict';

// Media library (/media, owner and leader): videos and backgrounds for the projector.
// Upload MP4 / WebM videos and backgrounds (JPEG / PNG / WebP images, MP4 / WebM silent
// loops) with progress, add YouTube / Vimeo / direct .mp4 links, filter (Toate · Video ·
// Fundaluri), thumbnails, rename, delete.

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const state = { data: null, renaming: null, deleting: null, uploading: false, filter: 'all' };

  const mb = (bytes) => {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const value = bytes / (1024 * 1024);
    return `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)} MB`;
  };

  function message(id, text, kind) {
    $(id).className = `message${kind ? ` ${kind}` : ''}`;
    $(id).textContent = text || '';
  }

  function setStatus(text) {
    $('status').removeAttribute('data-i18n');
    $('status').textContent = text;
    $('status').hidden = !text;
  }

  function describe(item) {
    const source = item.source;
    if (item.kind === 'image') return [t('media.kinds.image'), item.width && item.height ? `${item.width}×${item.height}` : null, mb(item.sizeBytes)].filter(Boolean).join(' · ');
    if (item.kind === 'loop') return `${t('media.kinds.loop')} · ${source.mime === 'video/webm' ? 'WebM' : 'MP4'} · ${mb(item.sizeBytes)}`;
    if (source.type === 'upload') return `${source.mime === 'video/webm' ? 'WebM' : 'MP4'} · ${mb(item.sizeBytes)}`;
    if (source.type === 'youtube') return 'YouTube';
    if (source.type === 'vimeo') return 'Vimeo';
    return t('media.directLink');
  }

  function render() {
    const data = state.data;
    if (!data) return;
    $('media-usage').textContent = t('media.usage', { used: mb(data.usedBytes), max: mb(data.maxAdminBytes) });
    $('upload-hint').textContent = t('media.uploadHint', { max: mb(data.maxFileBytes) });
    $('bg-hint').textContent = t('media.bgHint', { image: mb(data.maxImageBytes), loop: mb(data.maxLoopBytes) });
    for (const button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter));
    const shown = data.media.filter((item) => state.filter === 'all' || item.category === state.filter);
    setStatus(data.media.length ? (shown.length ? '' : t('media.emptyFilter')) : t('media.empty'));
    $('media-list').replaceChildren(...shown.map((item) => el('li', { class: 'screen-row media-row' },
      thumbOf(item),
      el('span', { class: 'screen-text' },
        el('span', { class: 'screen-name', text: item.title }),
        el('span', { class: 'screen-meta', text: describe(item) })),
      el('span', { class: 'screen-tools' },
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'edit', text: t('screens.rename'), 'aria-label': t('media.renameLabel', { title: item.title }), onclick: () => openRename(item) }),
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'close', text: t('media.delete'), 'aria-label': t('media.deleteLabel', { title: item.title }), onclick: () => openDelete(item) })))));
  }

  // Images: the server's thumbnail; video files and loops: their first frame (the browser
  // loads only the metadata); links: a plain tile.
  function thumbOf(item) {
    const src = `/api/media/${item.id}/file`;
    if (item.kind === 'image' && item.thumb) return el('img', { class: 'media-thumb', src: `${src}?v=thumb`, alt: '', loading: 'lazy' });
    if (item.source.type === 'upload') {
      return el('video', { class: 'media-thumb', src: `${src}#t=0.5`, muted: true, preload: 'metadata', playsinline: true, 'aria-hidden': 'true', tabindex: '-1' });
    }
    return el('span', { class: 'media-thumb media-thumb-link', 'aria-hidden': 'true' });
  }

  for (const button of document.querySelectorAll('[data-filter]')) {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      render();
    });
  }

  async function load() {
    const res = await api('/api/media');
    if (!res.ok) return setStatus(res.body.error || t('common.networkError'));
    state.data = res.body;
    render();
  }

  // --- upload with progress (XMLHttpRequest reports upload progress) ---------------

  // as: 'video' | 'background'; ids: the section's input, progress and message elements.
  function upload(file, as, ids) {
    if (!file || state.uploading) return;
    message(ids.message, '');
    const limit = state.data && (as === 'video' ? state.data.maxFileBytes
      : file.type.startsWith('image/') ? state.data.maxImageBytes : state.data.maxLoopBytes);
    if (limit && file.size > limit) return message(ids.message, t('errors.mediaTooLarge', { max: mb(limit) }), 'error');
    const title = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || file.name;
    const xhr = new XMLHttpRequest();
    state.uploading = true;
    $(ids.progress).hidden = false;
    $(ids.name).textContent = file.name;
    $(ids.bar).value = 0;
    $(ids.percent).textContent = '0%';
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      $(ids.bar).value = percent;
      $(ids.percent).textContent = `${percent}%`;
    });
    xhr.addEventListener('loadend', async () => {
      state.uploading = false;
      $(ids.progress).hidden = true;
      let body = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch (err) {
        body = {};
      }
      if (xhr.status === 201) {
        message(ids.message, t('media.uploaded', { title: body.media.title }), 'success');
        await load();
      } else if (xhr.status === 401) {
        window.location.replace('/login');
      } else {
        // 503: the server is restarting (it answers uploads in progress before it stops).
        message(ids.message, body.error || t(xhr.status === 503 ? 'errors.restarting' : 'common.networkError'), 'error');
      }
    });
    xhr.open('POST', `/api/media/upload?as=${as}&title=${encodeURIComponent(title)}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file);
  }

  for (const [input, as, prefix] of [['upload-file', 'video', 'upload'], ['bg-file', 'background', 'bg']]) {
    $(input).addEventListener('change', () => {
      const file = $(input).files[0];
      $(input).value = '';
      upload(file, as, { message: `${prefix}-message`, progress: `${prefix}-progress`, name: `${prefix}-name`, bar: `${prefix}-bar`, percent: `${prefix}-percent` });
    });
  }

  // --- links ------------------------------------------------------------------------

  $('url-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    message('url-message', '');
    const res = await api('/api/media/url', { method: 'POST', body: { title: $('url-title').value, url: $('url-value').value } });
    if (!res.ok) return message('url-message', res.body.error || t('common.networkError'), 'error');
    message('url-message', t('media.added', { title: res.body.media.title }), 'success');
    $('url-title').value = '';
    $('url-value').value = '';
    await load();
  });

  // --- rename / delete --------------------------------------------------------------

  function openRename(item) {
    state.renaming = item;
    $('rename-title').value = item.title;
    $('rename-message').textContent = '';
    $('rename-dialog').showModal();
  }

  $('rename-cancel').addEventListener('click', () => $('rename-dialog').close());
  $('rename-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const res = await api(`/api/media/${state.renaming.id}`, { method: 'PUT', body: { title: $('rename-title').value } });
    if (!res.ok) {
      $('rename-message').textContent = res.body.error || t('common.networkError');
      return;
    }
    $('rename-dialog').close();
    await load();
  });

  function openDelete(item) {
    state.deleting = item;
    $('delete-text').textContent = t('media.deleteText', { title: item.title });
    $('delete-dialog').returnValue = '';
    $('delete-dialog').showModal();
  }

  $('delete-dialog').addEventListener('close', async () => {
    if ($('delete-dialog').returnValue !== 'delete' || !state.deleting) return;
    const res = await api(`/api/media/${state.deleting.id}`, { method: 'DELETE' });
    if (!res.ok) setStatus(res.body.error || t('common.networkError'));
    await load();
  });

  document.addEventListener('i18n:change', () => {
    setTitle('media.pageTitle');
    render();
  });

  setTitle('media.pageTitle');
  load().catch(() => setStatus(t('common.networkError')));
})();
