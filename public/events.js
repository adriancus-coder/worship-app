'use strict';

(function () {
  const { api, el, canEdit, formatDate, dateBlock, setupTabs } = window.PAGE;
  const { t } = window.I18N;
  const WHEN = ['upcoming', 'past', 'templates'];
  const tabButtons = WHEN.map((w) => document.getElementById(`tab-${w}`));
  const list = document.getElementById('events');
  const status = document.getElementById('status');
  const newButton = document.getElementById('new-event');
  const dialog = document.getElementById('create-dialog');
  const form = document.getElementById('create-form');
  const nameInput = document.getElementById('new-name');
  const dateInput = document.getElementById('new-date');
  const timeInput = document.getElementById('new-time');
  const templateSelect = document.getElementById('new-template');
  const eventSelect = document.getElementById('new-source-event');
  const message = document.getElementById('create-message');
  const submit = document.getElementById('create-submit');

  const state = { me: null, when: 'upcoming', data: null, sources: null, requestId: 0 };

  function setStatus(text) {
    status.removeAttribute('data-i18n');
    status.textContent = text;
    status.hidden = !text;
  }

  function countText(n) {
    if (n === 0) return t('events.itemCountZero');
    return n === 1 ? t('events.itemCountOne') : t('events.itemCount', { n });
  }

  function eventHref(event) {
    return canEdit(state.me) ? `/events/${event.id}/edit` : `/events/${event.id}`;
  }

  function card(event, today) {
    const block = dateBlock(event.eventDate);
    const meta = [event.startTime, countText(event.itemCount)].filter(Boolean).join(' · ');
    return el('li', null,
      el('a', { class: 'event-card', href: eventHref(event) },
        event.isTemplate
          ? el('span', { class: 'date-block template-block', 'aria-hidden': 'true' }, el('span', { class: 'date-day', text: '⧉' }))
          : el('span', { class: 'date-block', 'aria-hidden': 'true' },
            el('span', { class: 'date-weekday', text: block.weekday }),
            el('span', { class: 'date-day', text: block.day }),
            el('span', { class: 'date-month', text: block.month })),
        el('span', { class: 'event-text' },
          el('span', { class: 'event-name', text: event.name }),
          // The date block is visual only; screen readers get the full date here.
          event.isTemplate ? null : el('span', { class: 'sr-only', text: formatDate(event.eventDate, today.slice(0, 4)) }),
          el('span', { class: 'event-meta', text: meta })),
        event.isTemplate
          ? el('span', { class: 'pill pill-template', text: t('events.template') })
          : el('span', { class: `pill pill-${event.status}`, text: t(`events.status.${event.status}`) })));
  }

  function render() {
    if (!state.data) return;
    const { events, today } = state.data;
    list.replaceChildren(...events.map((event) => card(event, today)));
    const empty = { upcoming: 'events.emptyUpcoming', past: 'events.emptyPast', templates: 'events.emptyTemplates' }[state.when];
    setStatus(events.length ? '' : t(empty));
  }

  async function load() {
    const id = ++state.requestId;
    const when = state.when;
    const url = new URL(window.location.href);
    if (when === 'upcoming') url.searchParams.delete('when');
    else url.searchParams.set('when', when);
    window.history.replaceState(null, '', url);
    try {
      const { ok, body } = await api(`/api/events?when=${when}`);
      if (id !== state.requestId) return;
      if (!ok) {
        setStatus(body.error || t('common.networkError'));
        return;
      }
      state.data = body;
      render();
    } catch (err) {
      if (id === state.requestId) setStatus(t('common.networkError'));
    }
  }

  const tabs = setupTabs(tabButtons, (index) => {
    state.when = WHEN[index];
    state.data = null;
    list.replaceChildren();
    setStatus(t('events.loading'));
    load();
  });

  // --- create dialog ----------------------------------------------------------

  // Next Sunday on or after today (YYYY-MM-DD), a sensible default for a church service.
  function nextSunday(today) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
    return d.toISOString().slice(0, 10);
  }

  function sourceMode() {
    return form.querySelector('input[name="source"]:checked').value;
  }

  function renderSources() {
    document.getElementById('template-field').hidden = sourceMode() !== 'template';
    document.getElementById('event-field').hidden = sourceMode() !== 'event';
    if (!state.sources) return;
    const { templates, events, today } = state.sources;
    const fill = (select, items, emptyKey, label) => {
      const value = select.value;
      select.replaceChildren(...(items.length
        ? items.map((e) => el('option', { value: e.id, text: label(e) }))
        : [el('option', { value: '', text: t(emptyKey) })]));
      if (value) select.value = value;
      select.disabled = items.length === 0;
    };
    fill(templateSelect, templates, 'events.noTemplates', (e) => e.name);
    fill(eventSelect, events, 'events.noEvents', (e) => `${formatDate(e.eventDate, today.slice(0, 4))} — ${e.name}`);
  }

  async function loadSources() {
    const [tpl, up, past] = await Promise.all(['templates', 'upcoming', 'past'].map((w) => api(`/api/events?when=${w}`)));
    state.sources = {
      today: up.body.today,
      templates: tpl.ok ? tpl.body.events : [],
      // Most recent first: past events newest first, then upcoming ones.
      events: [...(past.ok ? past.body.events : []), ...(up.ok ? up.body.events.slice().reverse() : [])]
        .sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1)),
    };
    renderSources();
  }

  newButton.addEventListener('click', () => {
    form.reset();
    message.textContent = '';
    const today = (state.data && state.data.today) || new Date().toISOString().slice(0, 10);
    dateInput.value = nextSunday(today);
    renderSources();
    dialog.showModal();
    nameInput.focus();
    loadSources().catch(() => { message.textContent = t('common.networkError'); });
  });

  form.addEventListener('change', (event) => {
    if (event.target.name === 'source') renderSources();
  });

  document.getElementById('create-cancel').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';
    const body = { name: nameInput.value, eventDate: dateInput.value, startTime: timeInput.value, notes: '' };
    const mode = sourceMode();
    if (mode === 'template') body.fromTemplateId = templateSelect.value || -1;
    if (mode === 'event') body.fromEventId = eventSelect.value || -1;
    submit.disabled = true;
    submit.textContent = t('events.creating');
    try {
      const res = await api('/api/events', { method: 'POST', body });
      if (res.status === 201) {
        window.location.assign(`/events/${res.body.event.id}/edit`);
        return;
      }
      message.textContent = res.body.error || t('common.networkError');
    } catch (err) {
      message.textContent = t('common.networkError');
    } finally {
      submit.disabled = false;
      submit.textContent = t('events.create');
    }
  });

  document.addEventListener('i18n:change', () => {
    render();
    renderSources();
    message.textContent = '';
  });

  // --- start ------------------------------------------------------------------

  (async () => {
    state.me = (await api('/api/auth/me')).body;
    const editor = canEdit(state.me);
    newButton.hidden = !editor;
    tabButtons[2].hidden = !editor;
    const asked = new URLSearchParams(window.location.search).get('when');
    const start = WHEN.indexOf(asked) >= 0 && (asked !== 'templates' || editor) ? WHEN.indexOf(asked) : 0;
    tabs.select(start, false);
    // "+ Eveniment nou" from the home page opens the dialog at once.
    const url = new URL(window.location.href);
    if (url.searchParams.has('new')) {
      url.searchParams.delete('new');
      window.history.replaceState(null, '', url);
      if (editor) newButton.click();
    }
  })().catch(() => setStatus(t('common.networkError')));
})();
