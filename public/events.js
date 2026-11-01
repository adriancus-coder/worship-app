'use strict';

(function () {
  const { api, el, canEditEvents: canEdit, formatDate, dateBlock, setupTabs } = window.PAGE;
  const { t } = window.I18N;
  const WHEN = ['upcoming', 'past'];
  const tabButtons = WHEN.map((w) => document.getElementById(`tab-${w}`));
  const list = document.getElementById('events');
  const status = document.getElementById('status');
  const newButton = document.getElementById('new-event');

  const state = { me: null, when: 'upcoming', data: null, requestId: 0 };

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
        el('span', { class: 'date-block', 'aria-hidden': 'true' },
          el('span', { class: 'date-weekday', text: block.weekday }),
          el('span', { class: 'date-day', text: block.day }),
          el('span', { class: 'date-month', text: block.month })),
        el('span', { class: 'event-text' },
          el('span', { class: 'event-name', text: event.name }),
          // The date block is visual only; screen readers get the full date here.
          el('span', { class: 'sr-only', text: formatDate(event.eventDate, today.slice(0, 4)) }),
          el('span', { class: 'event-meta', text: meta }),
          // the event's note, when there is one (two lines at most)
          event.notes ? el('span', { class: 'event-note', text: event.notes }) : null),
        el('span', { class: `pill pill-${event.status}`, text: t(`events.status.${event.status}`) })));
  }

  function render() {
    if (!state.data) return;
    const { events, today } = state.data;
    list.replaceChildren(...events.map((event) => card(event, today)));
    const empty = { upcoming: 'events.emptyUpcoming', past: 'events.emptyPast' }[state.when];
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

  // "+ Eveniment nou": the form (public/event-new.js); the event is created only after it.
  newButton.addEventListener('click', () => window.EVENT_NEW.open());

  document.addEventListener('i18n:change', render);
  // "Planifică" (public/events-plan.js) made events: the list again, with how many.
  document.addEventListener('events:planned', async (event) => {
    if (state.when !== 'upcoming') tabs.select(0, false);
    else await load();
    const note = document.getElementById('plan-done');
    note.textContent = t('plan.done', { n: event.detail.created });
    note.hidden = false;
  });

  // --- start ------------------------------------------------------------------

  (async () => {
    state.me = (await api('/api/auth/me')).body;
    const editor = canEdit(state.me);
    newButton.hidden = !editor;
    const asked = new URLSearchParams(window.location.search).get('when');
    const start = WHEN.indexOf(asked) >= 0 ? WHEN.indexOf(asked) : 0;
    tabs.select(start, false);
    // "+ Eveniment nou" from the home page: the same one tap.
    const url = new URL(window.location.href);
    if (url.searchParams.has('new')) {
      url.searchParams.delete('new');
      window.history.replaceState(null, '', url);
      if (editor) newButton.click();
    }
  })().catch(() => setStatus(t('common.networkError')));
})();
