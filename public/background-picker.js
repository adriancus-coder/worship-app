'use strict';

// Choosing a projector background (lib/backgrounds.js): the song editor ("Fundal implicit"),
// the event editor (per item), the settings (church defaults) and the live pages (the live
// override) all use this one picker: a dialog of thumbnails, on phones a bottom sheet.
// Picking a tile applies it and closes; Escape / ✕ close without a change.
//
//   BG_PICKER.list()                    // the background media (images, loops), cached
//   BG_PICKER.defaults()                // the church defaults { song, verse, announcement }
//   BG_PICKER.inheritedName(type, songChoice)
//                                       // what "Implicit" gives an item of that type
//   BG_PICKER.nameOf(choice, list)      // null -> '', 'none' -> "Fără", id -> its title
//   BG_PICKER.open({ heading, current, inherit, noneValue, recent, onPick })
//     current: null (inherit) | 'none' | media id; inherit: the text of "Implicit (…)" or
//     null for no such tile; noneValue: what "Fără" picks ('none', or null in the settings);
//     recent: media ids shown first ("Folosite în acest eveniment").
//   BG_PICKER.field({ id, label, hint, value, inherit, noneValue, onChange })
//     -> { node, value, set(value), setInherit(text) }: a labelled button showing the choice.

(function () {
  const { api, el } = window.PAGE;
  const { t } = window.I18N;
  let cache = null;

  // Which church default an item type uses (lib/backgrounds.js DEFAULT_OF_TYPE).
  const DEFAULT_OF_TYPE = { song: 'song', verse: 'verse', announcement: 'announcement', sermon: 'announcement', other: 'announcement' };

  function load(force) {
    if (!cache || force) {
      cache = api('/api/media').then((res) => (res.ok
        ? { items: res.body.media.filter((m) => m.category === 'background'), defaults: res.body.backgroundDefaults || {} }
        : { items: [], defaults: {} })).catch(() => ({ items: [], defaults: {} }));
    }
    return cache;
  }
  const list = (force) => load(force).then((x) => x.items);
  const defaults = () => load().then((x) => x.defaults);

  // The name of what applies without an own choice: the song's default (songChoice: null |
  // 'none' | id, song items only), else the church default for the type, else "Fără".
  async function inheritedName(type, songChoice = null) {
    const { items, defaults: church } = await load();
    const title = (id) => (items.find((m) => m.id === Number(id)) || {}).title;
    if (type === 'song' && songChoice === 'none') return t('background.none');
    if (type === 'song' && songChoice !== null && title(songChoice)) return title(songChoice);
    return title(church[DEFAULT_OF_TYPE[type] || 'announcement']) || t('background.none');
  }

  // A 16:9 thumbnail: the image's small version, a loop's first frame, black for "none".
  function thumb(item) {
    if (!item) return el('span', { class: 'bg-thumb bg-thumb-none', 'aria-hidden': 'true' });
    const src = `/api/media/${item.id}/file`;
    if (item.kind === 'image') return el('img', { class: 'bg-thumb', src: `${src}?v=${item.thumb ? 'thumb' : 'display'}`, alt: '', loading: 'lazy' });
    return el('video', { class: 'bg-thumb', src: `${src}#t=0.5`, muted: true, preload: 'metadata', playsinline: true, 'aria-hidden': 'true', tabindex: '-1' });
  }

  function nameOf(choice, items) {
    if (choice === 'none') return t('background.none');
    if (choice === null || choice === undefined) return '';
    const item = (items || []).find((m) => m.id === Number(choice));
    return item ? item.title : '';
  }

  function tile(label, detail, preview, pressed, onClick) {
    return el('button', { type: 'button', class: 'bg-tile', 'aria-pressed': String(pressed), onclick: onClick },
      preview,
      el('span', { class: 'bg-tile-name' }, label, detail ? el('span', { class: 'bg-tile-detail', text: ` · ${detail}` }) : null));
  }

  async function open({ heading, current = null, inherit = null, noneValue = 'none', recent = [], onPick }) {
    const dialog = el('dialog', { class: 'preview-dialog bg-picker', 'aria-labelledby': 'bg-picker-heading' });
    const body = el('div', { class: 'preview-dialog-body' }, el('p', { class: 'hint', role: 'status', text: t('background.loading') }));
    const close = () => dialog.close();
    dialog.append(
      el('div', { class: 'preview-dialog-head' },
        el('div', { class: 'preview-dialog-title' }, el('h2', { id: 'bg-picker-heading', tabindex: '-1', text: heading || t('background.choose') })),
        el('button', { type: 'button', class: 'secondary preview-close-x', 'data-icon': 'close', 'aria-label': t('shell.close'), onclick: close })),
      body);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); }); // the backdrop
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('h2').focus();

    const items = await list();
    const pick = (value) => {
      close();
      if (onPick) onPick(value);
    };
    const grid = (tiles) => el('div', { class: 'bg-grid' }, tiles);
    const mediaTile = (item) => tile(item.title, item.kind === 'loop' ? t('background.loop') : '', thumb(item),
      current !== null && current !== 'none' && Number(current) === item.id, () => pick(item.id));
    const first = [];
    if (inherit !== null) first.push(tile(t('background.inherit', { name: inherit }), '', el('span', { class: 'bg-thumb bg-thumb-inherit', 'aria-hidden': 'true' }), current === null, () => pick(null)));
    first.push(tile(t('background.none'), t('background.noneHint'), thumb(null), current === (noneValue === null ? null : 'none') && !(inherit !== null && current === null), () => pick(noneValue)));
    const parts = [grid(first)];
    const recentItems = recent.map((id) => items.find((m) => m.id === Number(id))).filter(Boolean);
    if (recentItems.length) parts.push(el('h3', { class: 'bg-group', text: t('background.recent') }), grid(recentItems.map(mediaTile)));
    if (items.length) parts.push(el('h3', { class: 'bg-group', text: t('background.all') }), grid(items.map(mediaTile)));
    else parts.push(el('p', { class: 'hint', text: t('background.empty') }));
    body.replaceChildren(...parts);
    const selected = body.querySelector('[aria-pressed="true"]');
    if (selected) selected.focus();
  }

  // A labelled button that shows the current choice and opens the picker.
  function field({ id, label, hint, value = null, inherit = null, noneValue = 'none', onChange }) {
    let current = value;
    let inheritText = inherit;
    const preview = el('span', { class: 'bg-field-thumb' });
    const name = el('span', { class: 'bg-field-name' });
    const button = el('button', { type: 'button', class: 'secondary bg-field', id, 'aria-describedby': hint ? `${id}-hint` : null },
      preview, name);
    const node = el('div', { class: 'field bg-field-row' },
      el('span', { class: 'label', id: `${id}-label`, text: label }),
      hint ? el('p', { class: 'hint', id: `${id}-hint`, text: hint }) : null,
      button);
    button.setAttribute('aria-labelledby', `${id}-label ${id}`);

    async function render() {
      const items = await list();
      const item = current !== null && current !== 'none' ? items.find((m) => m.id === Number(current)) : null;
      let text;
      if (current === null && inheritText !== null) text = t('background.inherit', { name: inheritText });
      else if (current === null || current === 'none') text = t('background.none');
      else text = item ? item.title : t('background.none');
      name.textContent = text;
      preview.replaceChildren(item ? thumb(item) : (current === null && inheritText !== null
        ? el('span', { class: 'bg-thumb bg-thumb-inherit', 'aria-hidden': 'true' }) : thumb(null)));
    }

    button.addEventListener('click', () => open({
      heading: label, current, inherit: inheritText, noneValue,
      onPick: (choice) => {
        current = choice;
        render();
        if (onChange) onChange(choice);
      },
    }));
    render();
    return {
      node,
      get value() { return current; },
      set(next) { current = next; render(); },
      setInherit(text) { inheritText = text; render(); },
    };
  }

  // The live pages' "Fundal" button (event roles): shows what is behind the text now and
  // opens the quick picker, which sets the live override (background.set); "Implicit" clears
  // it. update(snap) with each live snapshot (it carries the event's resolved backgrounds).
  function liveButton(container, { send }) {
    let snap = null;
    const preview = el('span', { class: 'bg-field-thumb' });
    const name = el('span', { class: 'bg-field-name' });
    const button = el('button', { type: 'button', class: 'secondary bg-field bg-live', disabled: true }, preview, name);
    container.replaceChildren(button);

    // The background media id the projector's item has without the override.
    function itemBackground() {
      const bgs = snap && snap.backgrounds;
      if (!bgs) return null;
      const pos = snap.projector && snap.projector.follows === 'operator' ? snap.projector : snap.worship;
      const id = pos && bgs.items ? bgs.items[pos.itemId] : null;
      return id || null;
    }

    function usedInEvent() {
      const bgs = (snap && snap.backgrounds) || {};
      const ids = [...Object.values(bgs.items || {}), ...Object.values(bgs.inherited || {}).map((x) => x && x.id)];
      return [...new Set(ids.filter(Boolean))];
    }

    async function render() {
      const items = await list();
      const live = Boolean(snap) && snap.status === 'live';
      button.disabled = !live;
      const override = snap ? snap.backgroundOverride : null;
      const title = (id) => (items.find((m) => m.id === Number(id)) || {}).title;
      let text;
      let shown = null;
      if (override === 'none') text = t('background.none');
      else if (override !== null && override !== undefined && title(override)) {
        shown = override;
        text = `${title(override)} · ${t('background.liveOverride')}`;
      } else {
        shown = itemBackground();
        text = t('background.inherit', { name: title(shown) || t('background.none') });
      }
      name.textContent = t('background.current', { name: text });
      button.setAttribute('aria-label', t('background.buttonLabel', { name: text }));
      const item = shown ? items.find((m) => m.id === Number(shown)) : null;
      preview.replaceChildren(item ? thumb(item) : thumb(null));
    }

    button.addEventListener('click', async () => {
      const items = await list();
      const inheritId = itemBackground();
      const inherit = (items.find((m) => m.id === Number(inheritId)) || {}).title || t('background.none');
      open({
        heading: t('background.label'),
        current: snap ? snap.backgroundOverride : null,
        inherit,
        recent: usedInEvent(),
        onPick: (choice) => send('background.set', { background: choice }),
      });
    });

    return {
      update(next) {
        snap = next;
        render();
      },
    };
  }

  window.BG_PICKER = { list, defaults, inheritedName, thumb, nameOf, open, field, liveButton };
})();
