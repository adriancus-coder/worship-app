'use strict';

// "+ Eveniment nou" on Evenimente (and the home's quick action, /events?new=1): the event is
// created only after the form: the name, the date on a month calendar (the next usual
// service preselected; days with an event carry a dot), the time from a list, the programme
// it starts with (ten random songs from any or one theme, a copy of a past event, or
// nothing) and a note. "Creează evenimentul" (POST /api/events/quick) opens the editor.

(function () {
  const { api, el } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const LOCALES = { ro: 'ro-RO', en: 'en-GB' };
  // --- shared with "Planifică" (public/events-plan.js) ------------------------------------
  // the time list: every quarter of an hour from 06:00 to 22:00, plus the usual time, preset
  function fillTimes(select, usual) {
    const times = [];
    for (let h = 6; h <= 22; h += 1) for (const m of [0, 15, 30, 45]) times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    if (usual && !times.includes(usual)) times.push(usual);
    times.sort();
    select.replaceChildren(el('option', { value: '', text: t('newEvent.noTime') }), ...times.map((x) => el('option', { value: x, text: x })));
    select.value = usual || '';
  }
  // the theme chips ("Oricare" + the library's themes; several can be pressed, "Oricare" =
  // none of them) and the past events to copy
  function fillProgrammeLists(themeGroup, copySelect, { themes, past, today }) {
    const chip = (value, text) => el('button', { type: 'button', class: 'theme-pick', 'data-theme': value, 'aria-pressed': String(!value), text, onclick: () => toggleTheme(themeGroup, value) });
    themeGroup.replaceChildren(chip('', t('newEvent.anyTheme')), ...themes.map((x) => chip(x.name, `${x.name} (${x.count})`)));
    const year = String(today || '').slice(0, 4);
    copySelect.replaceChildren(el('option', { value: '', text: t(past.length ? 'setlist.pickEvent' : 'events.noEvents') }),
      ...past.map((e) => el('option', { value: String(e.id), text: `${window.PAGE.formatDate(e.eventDate, year)} — ${e.name}` })));
    copySelect.disabled = !past.length;
  }
  function toggleTheme(group, value) {
    const chips = [...group.querySelectorAll('.theme-pick')];
    if (value) {
      const chip = chips.find((x) => x.dataset.theme === value);
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    } else for (const x of chips) if (x.dataset.theme) x.setAttribute('aria-pressed', 'false');
    const any = chips.some((x) => x.dataset.theme && x.getAttribute('aria-pressed') === 'true');
    chips[0].setAttribute('aria-pressed', String(!any));
  }
  // the pressed themes (none = any song)
  function chosenThemes(group) {
    return [...group.querySelectorAll('.theme-pick[aria-pressed="true"]')].map((x) => x.dataset.theme).filter(Boolean);
  }
  // the programme switch (random / copy / empty): the pressed button, the theme / copy fields
  function renderProgrammeChoice(group, value, themeField, copyField) {
    for (const button of group.querySelectorAll('[data-programme]')) button.setAttribute('aria-pressed', String(button.dataset.programme === value));
    themeField.hidden = value !== 'random';
    copyField.hidden = value !== 'copy';
  }
  window.EVENT_NEW = { fillTimes, fillProgrammeLists, renderProgrammeChoice, chosenThemes };

  const dialog = $('new-dialog');
  if (!dialog) return;

  const state = { defaults: null, today: null, month: null, date: null, busy: new Map(), past: [], programme: 'random', loading: false };
  const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const locale = () => LOCALES[window.I18N.lang] || LOCALES.ro;
  const fmt = (date, options) => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...options }).format(date);
  const longDate = (date) => fmt(new Date(`${date}T12:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long' });

  function say(text) {
    $('new-message').textContent = text || '';
  }

  const renderTimes = (usual) => fillTimes($('new-time'), usual);

  function renderCalendar() {
    const { y, m } = state.month;
    const first = new Date(Date.UTC(y, m, 1));
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const monthName = fmt(first, { month: 'long', year: 'numeric' });
    $('new-month').textContent = monthName.charAt(0).toLocaleUpperCase() + monthName.slice(1);
    const [ty, tm] = state.today.split('-').map(Number);
    $('new-prev').disabled = y < ty || (y === ty && m <= tm - 1);
    const weekdays = [...Array(7)].map((_, i) => el('span', { class: 'plan-wd new-wd', 'aria-hidden': 'true', text: fmt(new Date(Date.UTC(2024, 0, 1 + i)), { weekday: 'short' }).replace(/\.$/, '').slice(0, 2) }));
    const cells = [...Array(lead)].map(() => el('span', { 'aria-hidden': 'true' }));
    for (let d = 1; d <= days; d += 1) {
      const date = iso(y, m, d);
      const busy = state.busy.get(date);
      cells.push(el('button', {
        type: 'button', class: `plan-day${date === state.today ? ' today' : ''}`, 'data-date': date,
        'aria-pressed': String(date === state.date), 'aria-label': `${longDate(date)}${busy ? ` · ${t('plan.hasEvent', { names: busy.join(', ') })}` : ''}`,
        title: busy ? busy.join(', ') : null, disabled: date < state.today ? 'disabled' : null,
        onclick: () => { state.date = date; renderCalendar(); },
      }, el('span', { text: String(d) }), busy ? el('span', { class: 'plan-dot', 'aria-hidden': 'true' }) : null));
    }
    $('new-grid').replaceChildren(...weekdays, ...cells);
    $('new-date-text').textContent = state.date ? longDate(state.date) : '';
  }

  function moveMonth(delta) {
    const m = state.month.m + delta;
    state.month = { y: state.month.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    renderCalendar();
  }

  const renderProgramme = () => renderProgrammeChoice($('new-programme'), state.programme, $('new-theme-field'), $('new-copy-field'));

  async function open() {
    say('');
    state.loading = true;
    const [defaults, upcoming, past, themes] = await Promise.all([
      api('/api/events/quick-defaults'), api('/api/events?when=upcoming'), api('/api/events?when=past'), api('/api/songs/themes'),
    ]).catch(() => [{ ok: false }]);
    state.loading = false;
    if (!defaults.ok) return;
    state.defaults = defaults.body;
    state.today = defaults.body.today;
    state.date = defaults.body.eventDate;
    const [y, m] = state.date.split('-').map(Number);
    state.month = { y, m: m - 1 };
    state.busy = new Map();
    if (upcoming.ok) for (const ev of upcoming.body.events) state.busy.set(ev.eventDate, [...(state.busy.get(ev.eventDate) || []), ev.name]);
    state.past = past.ok ? past.body.events : [];
    $('new-name').value = defaults.body.name;
    $('new-notes').value = '';
    renderTimes(defaults.body.startTime || '');
    renderCalendar();
    fillProgrammeLists($('new-theme'), $('new-copy'), { themes: themes.ok ? themes.body.themes : [], past: state.past, today: state.today });
    state.programme = 'random';
    renderProgramme();
    $('new-create').disabled = false;
    dialog.showModal();
    $('new-name').focus();
    $('new-name').select();
  }

  async function create(event) {
    event.preventDefault();
    const name = $('new-name').value.trim();
    if (!name) { say(t('newEvent.nameMissing')); $('new-name').focus(); return; }
    if (state.programme === 'copy' && !$('new-copy').value) { say(t('newEvent.copyMissing')); $('new-copy').focus(); return; }
    const button = $('new-create');
    button.disabled = true;
    say('');
    const body = {
      name, eventDate: state.date, startTime: $('new-time').value, notes: $('new-notes').value.trim(),
      programme: state.programme, themes: state.programme === 'random' ? chosenThemes($('new-theme')) : [], fromEventId: state.programme === 'copy' ? Number($('new-copy').value) : undefined,
    };
    const res = await api('/api/events/quick', { method: 'POST', body }).catch(() => ({ ok: false, body: {} }));
    if (res.status === 201) {
      window.location.assign(`/events/${res.body.event.id}/edit`);
      return;
    }
    button.disabled = false;
    say(res.body.error || t('common.networkError'));
  }

  $('new-prev').addEventListener('click', () => moveMonth(-1));
  $('new-next').addEventListener('click', () => moveMonth(1));
  for (const button of document.querySelectorAll('#new-programme [data-programme]')) {
    button.addEventListener('click', () => { state.programme = button.dataset.programme; renderProgramme(); });
  }
  $('new-form').addEventListener('submit', create);
  $('new-cancel').addEventListener('click', () => dialog.close());
  document.addEventListener('i18n:change', () => { if (dialog.open) { renderCalendar(); renderProgramme(); } });

  window.EVENT_NEW.open = open;
})();
