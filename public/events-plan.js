'use strict';

// "Planifică" on Evenimente (the 'events' right): many events at once. A month calendar (‹ ›
// between months, weeks from Monday): tap days to choose them (the chosen ones filled and
// checked; days already holding an event carry a dot; past days are off); tap a weekday name
// ("DU") to choose / clear every such day of the month. The template (its items, team, name
// and time), or a name and a time, and a note apply to every day; "Creează N evenimente"
// makes them all (POST /api/events/plan) and the list reloads.

(function () {
  const { api, el, canEditEvents } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const LOCALES = { ro: 'ro-RO', en: 'en-GB' };
  const state = { today: null, month: null, chosen: new Set(), busy: new Map(), templates: [] };

  const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const locale = () => LOCALES[window.I18N.lang] || LOCALES.ro;
  const fmt = (date, options) => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...options }).format(date);

  async function open() {
    $('plan-message').textContent = '';
    const [upcoming, templates] = await Promise.all([api('/api/events?when=upcoming'), api('/api/events?when=templates')]).catch(() => [{ ok: false }, { ok: false }]);
    if (!upcoming.ok) return;
    state.today = upcoming.body.today;
    state.busy = new Map();
    for (const ev of upcoming.body.events) state.busy.set(ev.eventDate, [...(state.busy.get(ev.eventDate) || []), ev.name]);
    state.templates = templates.ok ? templates.body.events : [];
    const [y, m] = state.today.split('-').map(Number);
    state.month = { y, m: m - 1 }; // each time from this month
    const select = $('plan-template');
    const keep = select.value;
    select.replaceChildren(el('option', { value: '', text: t('plan.noTemplate') }), ...state.templates.map((tpl) => el('option', { value: String(tpl.id), text: tpl.name })));
    select.value = state.templates.some((tpl) => String(tpl.id) === keep) ? keep : (state.templates[0] ? String(state.templates[0].id) : '');
    onTemplate();
    render();
    $('plan-dialog').showModal();
  }

  // The template fills the name and the time as placeholders (an empty field keeps them).
  function onTemplate() {
    const tpl = state.templates.find((x) => String(x.id) === $('plan-template').value);
    $('plan-name').placeholder = tpl ? tpl.name : t('plan.namePlaceholder');
    $('plan-time').value = tpl && tpl.startTime ? tpl.startTime : $('plan-time').value;
  }

  function render() {
    const { y, m } = state.month;
    const first = new Date(Date.UTC(y, m, 1));
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const monthName = fmt(first, { month: 'long', year: 'numeric' });
    $('plan-month').textContent = monthName.charAt(0).toLocaleUpperCase() + monthName.slice(1);
    // the previous month only while it still has days from today on
    const [ty, tm] = state.today.split('-').map(Number);
    $('plan-prev').disabled = y < ty || (y === ty && m <= tm - 1);
    const weekdays = [...Array(7)].map((_, i) => {
      const day = new Date(Date.UTC(2024, 0, 1 + i)); // 2024-01-01 was a Monday
      const dates = [...Array(days)].map((__, d) => iso(y, m, d + 1)).filter((date) => new Date(`${date}T12:00:00Z`).getUTCDay() === day.getUTCDay() && date >= state.today);
      return el('button', {
        type: 'button', class: 'plan-wd', 'data-weekday': String(i), disabled: dates.length ? null : 'disabled',
        'aria-label': t('plan.allWeekday', { day: fmt(day, { weekday: 'long' }) }),
        text: fmt(day, { weekday: 'short' }).replace(/\.$/, '').slice(0, 2),
        onclick: () => {
          const all = dates.every((date) => state.chosen.has(date));
          for (const date of dates) (all ? state.chosen.delete(date) : state.chosen.add(date));
          render();
        },
      });
    });
    const cells = [...Array(lead)].map(() => el('span', { 'aria-hidden': 'true' }));
    for (let d = 1; d <= days; d++) {
      const date = iso(y, m, d);
      const busy = state.busy.get(date);
      const label = `${fmt(new Date(`${date}T12:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long' })}${busy ? ` · ${t('plan.hasEvent', { names: busy.join(', ') })}` : ''}`;
      cells.push(el('button', {
        type: 'button', class: `plan-day${date === state.today ? ' today' : ''}`, 'data-date': date,
        'aria-pressed': String(state.chosen.has(date)), 'aria-label': label, title: busy ? busy.join(', ') : null,
        disabled: date < state.today ? 'disabled' : null,
        onclick: () => { (state.chosen.has(date) ? state.chosen.delete(date) : state.chosen.add(date)); render(); },
      }, el('span', { text: String(d) }), busy ? el('span', { class: 'plan-dot', 'aria-hidden': 'true' }) : null));
    }
    $('plan-grid').replaceChildren(...weekdays, ...cells);
    const n = state.chosen.size;
    $('plan-count').textContent = n ? t('plan.chosen', { n, dates: [...state.chosen].sort().map((date) => fmt(new Date(`${date}T12:00:00Z`), { day: 'numeric', month: 'short' })).join(', ') }) : t('plan.noneChosen');
    $('plan-create').textContent = n === 1 ? t('plan.createOne') : t('plan.create', { n });
    $('plan-create').disabled = !n;
  }

  function move(delta) {
    const m = state.month.m + delta;
    state.month = { y: state.month.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    render();
  }

  async function create(event) {
    event.preventDefault();
    if (!state.chosen.size) return;
    const button = $('plan-create');
    button.disabled = true;
    const templateId = Number($('plan-template').value) || null;
    const body = { dates: [...state.chosen].sort(), templateId, name: $('plan-name').value.trim(), startTime: $('plan-time').value, notes: $('plan-notes').value.trim() };
    const res = await api('/api/events/plan', { method: 'POST', body }).catch(() => ({ ok: false, body: {} }));
    button.disabled = false;
    if (!res.ok) {
      $('plan-message').textContent = res.body.error || t('common.networkError');
      return;
    }
    state.chosen.clear();
    $('plan-name').value = '';
    $('plan-notes').value = '';
    $('plan-dialog').close();
    document.dispatchEvent(new CustomEvent('events:planned', { detail: { created: res.body.created } }));
  }

  $('plan-prev').addEventListener('click', () => move(-1));
  $('plan-next').addEventListener('click', () => move(1));
  $('plan-template').addEventListener('change', onTemplate);
  $('plan-form').addEventListener('submit', create);
  $('plan-events').addEventListener('click', open);
  document.addEventListener('i18n:change', () => { if ($('plan-dialog').open) render(); });

  api('/api/auth/me').then((res) => { $('plan-events').hidden = !(res.ok && canEditEvents(res.body)); }).catch(() => {});
})();
