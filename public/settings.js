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
    renderService(res.body.service);
    renderClock(res.body.clock);
    renderTimeFormat(res.body.timeFormat);
    renderBackup(res.body.backup);
    renderStorage(res.body.storage);
    await renderBackgrounds(res.body.backgroundDefaults || {});
  }

  // --- storage: the app's data out of the whole disk; the reserved free share shaded ---

  let storageInfo = null;
  const mbText = (bytes) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

  function renderStorage(info) {
    storageInfo = info || storageInfo;
    if (!storageInfo) return;
    const { dataBytes, diskBytes, freeBytes, minFreePct } = storageInfo;
    const used = t('settings.storageUsed', { used: mbText(dataBytes), total: mbText(diskBytes) });
    $('storage-used').textContent = used;
    $('storage-bar').setAttribute('aria-label', used);
    const pct = diskBytes ? Math.min(100, (dataBytes / diskBytes) * 100) : 0;
    $('storage-fill').style.width = `${pct.toFixed(2)}%`;
    $('storage-bar').classList.toggle('high', pct > 70);
    $('storage-reserve').style.width = `${minFreePct}%`;
    $('storage-hint').textContent = t('settings.storageHint', { pct: minFreePct, free: mbText(freeBytes) });
  }

  // --- backup: the last download and the button (GET /api/backup streams the .zip) ---

  let backupInfo = null;
  const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  function renderBackup(info) {
    backupInfo = info || backupInfo;
    const last = backupInfo && backupInfo.lastAt;
    $('backup-last').textContent = last
      ? t('settings.backupLast', {
        date: new Date(last).toLocaleString(window.I18N.lang === 'ro' ? 'ro-RO' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        size: sizeText(backupInfo.lastBytes || 0),
      })
      : t('settings.backupNever');
  }

  // The browser downloads it; the date and size shown here follow once the server has it.
  $('backup-download').addEventListener('click', () => {
    $('backup-message').className = 'message';
    $('backup-message').textContent = t('settings.backupStarted');
    const refresh = async () => {
      const res = await api('/api/settings').catch(() => null);
      if (res && res.ok) renderBackup(res.body.backup);
    };
    setTimeout(refresh, 4000);
    setTimeout(refresh, 15000);
  });

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

  // "Ziua și ora obișnuită a slujbei" (the defaults of "+ Eveniment nou"), saved on change.
  let service = null;
  function renderService(value) {
    if (value) service = value;
    if (!service) return;
    const names = new Intl.DateTimeFormat(window.I18N.lang, { weekday: 'long', timeZone: 'UTC' });
    const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first
    $('service-day').replaceChildren(...order.map((day) => el('option', { value: String(day), text: names.format(new Date(Date.UTC(2023, 0, 1 + day))) })));
    $('service-day').value = String(service.weekday);
    if (document.activeElement !== $('service-time')) $('service-time').value = service.time;
  }

  async function saveService() {
    const out = $('service-message');
    const body = { weekday: Number($('service-day').value), time: $('service-time').value };
    const res = await api('/api/settings/service', { method: 'PUT', body });
    out.className = `message ${res.ok ? 'success' : 'error'}`;
    out.textContent = res.ok ? t('settings.serviceSaved') : res.body.error || t('common.networkError');
    if (res.ok) renderService(res.body.service);
  }
  $('service-day').addEventListener('change', saveService);
  $('service-time').addEventListener('change', saveService);
  document.addEventListener('i18n:change', () => renderService());

  // The corner clock a new event starts with (public/clock-panel.js, the live pages' controls).
  let clock = null;
  const clockPanel = window.CLOCK_PANEL.create($('clock-panel'), {
    t, el, prefix: 'clock-default',
    onChange: async (patch) => {
      const res = await api('/api/settings/clock', { method: 'PUT', body: patch });
      const out = $('clock-message');
      out.className = `message ${res.ok ? 'success' : 'error'}`;
      out.textContent = res.ok ? t('settings.clockSaved') : res.body.error || t('common.networkError');
      if (res.ok) renderClock(res.body.clock);
    },
  });
  function renderClock(value) {
    if (value) clock = value;
    if (clock) clockPanel.update({ clock, enabled: true });
  }

  // 24 h / 12 h, for every clock (the projector's and the live pages').
  function renderTimeFormat(format) {
    for (const button of document.querySelectorAll('[data-time-format]')) {
      button.setAttribute('aria-pressed', String(button.dataset.timeFormat === format));
    }
  }
  for (const button of document.querySelectorAll('[data-time-format]')) {
    button.addEventListener('click', async () => {
      const res = await api('/api/settings/time-format', { method: 'PUT', body: { format: button.dataset.timeFormat } });
      const out = $('time-format-message');
      out.className = `message ${res.ok ? 'success' : 'error'}`;
      out.textContent = res.ok ? t('settings.timeFormatSaved') : res.body.error || t('common.networkError');
      if (res.ok) renderTimeFormat(res.body.timeFormat);
    });
  }

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
    $('backup-message').textContent = '';
    $('clock-message').textContent = '';
    $('time-format-message').textContent = '';
    clockPanel.render();
    renderBackup(null);
    renderStorage(null);
    renderBackgrounds(bg.defaults).catch(() => {});
  });

  setTitle('settings.pageTitle');
  load().catch(() => message(t('common.networkError'), 'error'));
})();
