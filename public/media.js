'use strict';

// Media library (/media, owner and leader): videos for the projector. Upload MP4 / WebM
// files (with progress), add YouTube / Vimeo / direct .mp4 links, rename, delete.

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const state = { data: null, renaming: null, deleting: null, uploading: false };

  const mb = (bytes) => {
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
    setStatus(data.media.length ? '' : t('media.empty'));
    $('media-list').replaceChildren(...data.media.map((item) => el('li', { class: 'screen-row' },
      el('span', { class: 'screen-text' },
        el('span', { class: 'screen-name', text: item.title }),
        el('span', { class: 'screen-meta', text: describe(item) })),
      el('span', { class: 'screen-tools' },
        el('button', { type: 'button', class: 'secondary', text: t('screens.rename'), 'aria-label': t('media.renameLabel', { title: item.title }), onclick: () => openRename(item) }),
        el('button', { type: 'button', class: 'secondary', text: t('media.delete'), 'aria-label': t('media.deleteLabel', { title: item.title }), onclick: () => openDelete(item) })))));
  }

  async function load() {
    const res = await api('/api/media');
    if (!res.ok) return setStatus(res.body.error || t('common.networkError'));
    state.data = res.body;
    render();
  }

  // --- upload with progress (XMLHttpRequest reports upload progress) ---------------

  $('upload-file').addEventListener('change', () => {
    const file = $('upload-file').files[0];
    $('upload-file').value = '';
    if (!file || state.uploading) return;
    message('upload-message', '');
    if (state.data && file.size > state.data.maxFileBytes) {
      return message('upload-message', t('errors.mediaTooLarge', { max: mb(state.data.maxFileBytes) }), 'error');
    }
    const title = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || file.name;
    const xhr = new XMLHttpRequest();
    state.uploading = true;
    $('upload-progress').hidden = false;
    $('upload-name').textContent = file.name;
    $('upload-bar').value = 0;
    $('upload-percent').textContent = '0%';
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      $('upload-bar').value = percent;
      $('upload-percent').textContent = `${percent}%`;
    });
    xhr.addEventListener('loadend', async () => {
      state.uploading = false;
      $('upload-progress').hidden = true;
      let body = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch (err) {
        body = {};
      }
      if (xhr.status === 201) {
        message('upload-message', t('media.uploaded', { title: body.media.title }), 'success');
        await load();
      } else if (xhr.status === 401) {
        window.location.replace('/login');
      } else {
        message('upload-message', body.error || t('common.networkError'), 'error');
      }
    });
    xhr.open('POST', `/api/media/upload?title=${encodeURIComponent(title)}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file);
  });

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
