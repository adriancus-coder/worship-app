'use strict';

// Admin settings (/settings, owner only): the default chord notation, the default colour
// theme, the default projector backgrounds with each background's readability, and the
// church logo shown by the projector.

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const MAX_BYTES = 2 * 1024 * 1024;
  const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  function message(text, kind) {
    $('logo-message').className = `message${kind ? ` ${kind}` : ''}`;
    $('logo-message').textContent = text || '';
  }

  function renderLogo(logo) {
    $('logo-image').hidden = !logo;
    $('logo-empty').hidden = Boolean(logo);
    $('logo-remove').hidden = !logo;
    if (logo) $('logo-image').src = logo.url;
    else $('logo-image').removeAttribute('src');
  }

  function renderNotation(notation) {
    for (const button of document.querySelectorAll('[data-notation]')) {
      button.setAttribute('aria-pressed', String(button.dataset.notation === notation));
    }
  }

  async function load() {
    const res = await api('/api/settings');
    if (!res.ok) return message(res.body.error || t('common.networkError'), 'error');
    renderLogo(res.body.logo);
    renderNotation(res.body.chordNotationDefault);
    renderThemeDefault(res.body.themeDefault);
    await renderBackgrounds(res.body.backgroundDefaults || {});
  }

  // --- backgrounds: the church defaults and each background's readability ---

  const BG = window.BG_PICKER;
  const DEFAULT_TYPES = { song: 'defaultSong', verse: 'defaultVerse', announcement: 'defaultAnnouncement' };
  const bg = { defaults: {}, items: [], selected: null, timer: null, view: null };

  function bgMessage(id, text, kind) {
    $(id).className = `message${kind ? ` ${kind}` : ''}`;
    $(id).textContent = text || '';
  }

  async function renderBackgrounds(defaults) {
    bg.defaults = defaults;
    bg.items = await BG.list(true);
    $('bg-defaults').replaceChildren(...Object.entries(DEFAULT_TYPES).map(([type, key]) => BG.field({
      id: `bg-default-${type}`, label: t(`background.${key}`), value: defaults[type] || null, noneValue: null,
      onChange: async (choice) => {
        const res = await api('/api/settings/backgrounds', { method: 'PUT', body: { [type]: choice } });
        if (res.ok) bg.defaults = res.body.backgroundDefaults;
        bgMessage('bg-defaults-message', res.ok ? t('background.defaultsSaved') : res.body.error || t('common.networkError'), res.ok ? 'success' : 'error');
      },
    }).node));
    const empty = bg.items.length === 0;
    $('bg-read-empty').hidden = !empty;
    document.querySelector('.bg-read-controls').hidden = empty;
    $('bg-read-preview').hidden = empty;
    if (empty) return;
    if (!bg.items.some((m) => m.id === bg.selected)) bg.selected = bg.items[0].id;
    $('bg-read-select').replaceChildren(...bg.items.map((m) => el('option', {
      value: String(m.id), text: m.kind === 'loop' ? `${m.title} · ${t('background.loop')}` : m.title,
    })));
    $('bg-read-select').value = String(bg.selected);
    renderReadability();
  }

  const selectedItem = () => bg.items.find((m) => m.id === bg.selected);

  // The controls and the 16:9 preview (the projector's own renderer) for the selected one.
  function renderReadability() {
    const item = selectedItem();
    if (!item) return;
    $('bg-dim').value = String(item.dim);
    $('bg-blur').value = String(item.blur);
    $('bg-dim-value').textContent = `${item.dim}%`;
    $('bg-blur-value').textContent = `${item.blur} px`;
    $('bg-shadow').setAttribute('aria-pressed', String(item.shadow));
    if (!bg.view) bg.view = window.PROJECTOR_RENDER.create($('bg-read-preview'));
    bg.view.show({
      kind: 'lyrics', lines: t('background.sample').split('\n'), version: 0, eventId: null,
      background: {
        id: item.id, kind: item.kind, dim: item.dim, blur: item.blur, shadow: item.shadow,
        url: `/api/media/${item.id}/file${item.kind === 'image' ? '?v=display' : ''}`,
      },
    });
  }

  // Applied to the preview at once, saved shortly after the last change.
  function changeReadability(values) {
    const item = selectedItem();
    if (!item) return;
    Object.assign(item, values);
    renderReadability();
    clearTimeout(bg.timer);
    bg.timer = setTimeout(async () => {
      const res = await api(`/api/media/${item.id}`, { method: 'PUT', body: { dim: item.dim, blur: item.blur, shadow: item.shadow } });
      bgMessage('bg-read-message', res.ok ? t('background.readSaved') : res.body.error || t('common.networkError'), res.ok ? 'success' : 'error');
    }, 400);
  }

  $('bg-read-select').addEventListener('change', () => {
    bg.selected = Number($('bg-read-select').value);
    bgMessage('bg-read-message', '');
    renderReadability();
  });
  $('bg-dim').addEventListener('input', () => changeReadability({ dim: Number($('bg-dim').value) }));
  $('bg-blur').addEventListener('input', () => changeReadability({ blur: Number($('bg-blur').value) }));
  $('bg-shadow').addEventListener('click', () => changeReadability({ shadow: !selectedItem().shadow }));

  function renderThemeDefault(theme) {
    for (const button of document.querySelectorAll('[data-theme-default]')) {
      button.setAttribute('aria-pressed', String(button.dataset.themeDefault === theme));
    }
  }

  for (const button of document.querySelectorAll('[data-theme-default]')) {
    button.addEventListener('click', async () => {
      const res = await api('/api/settings/theme-default', { method: 'PUT', body: { theme: button.dataset.themeDefault } });
      const out = $('theme-message');
      out.className = `message ${res.ok ? 'success' : 'error'}`;
      out.textContent = res.ok ? t('settings.themeSaved') : res.body.error || t('common.networkError');
      if (res.ok) renderThemeDefault(res.body.themeDefault);
    });
  }

  for (const button of document.querySelectorAll('[data-notation]')) {
    button.addEventListener('click', async () => {
      const res = await api('/api/settings/chord-notation', { method: 'PUT', body: { notation: button.dataset.notation } });
      const out = $('notation-message');
      if (!res.ok) {
        out.className = 'message error';
        out.textContent = res.body.error || t('common.networkError');
        return;
      }
      renderNotation(res.body.chordNotationDefault);
      out.className = 'message success';
      out.textContent = t('settings.notationSaved');
    });
  }

  $('logo-file').addEventListener('change', async () => {
    const file = $('logo-file').files[0];
    $('logo-file').value = '';
    if (!file) return;
    // Quick checks here; the server checks the real content (magic bytes).
    if (!TYPES.includes(file.type)) return message(t('errors.logoInvalid'), 'error');
    if (file.size > MAX_BYTES) return message(t('errors.logoTooLarge', { max: '2 MB' }), 'error');
    message(t('settings.logoUploading'));
    try {
      const res = await fetch('/api/settings/logo', { method: 'PUT', body: file, headers: { 'Content-Type': file.type }, cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return message(body.error || t('common.networkError'), 'error');
      renderLogo(body.logo);
      message(t('settings.logoSaved'), 'success');
    } catch (err) {
      message(t('common.networkError'), 'error');
    }
  });

  $('logo-remove').addEventListener('click', async () => {
    const res = await api('/api/settings/logo', { method: 'DELETE' });
    if (!res.ok) return message(res.body.error || t('common.networkError'), 'error');
    renderLogo(null);
    message(t('settings.logoRemoved'), 'success');
  });

  document.addEventListener('i18n:change', () => {
    setTitle('settings.pageTitle');
    message('');
    $('notation-message').textContent = '';
    bgMessage('bg-defaults-message', '');
    renderBackgrounds(bg.defaults).catch(() => {});
  });

  setTitle('settings.pageTitle');
  load().catch(() => message(t('common.networkError'), 'error'));
})();
