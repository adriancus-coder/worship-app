'use strict';

// "Profilul meu → Indisponibil" (lib/unavailability.js): one's own date ranges when one cannot
// serve, with an optional reason; add / remove. The leader's assignment picker greys the
// person out on those days.

(function () {
  const { api, el, formatDate } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const state = { ranges: [], today: null };

  function say(text, kind) {
    $('unavail-message').className = `message${kind ? ` ${kind}` : ''}`;
    $('unavail-message').textContent = text || '';
  }

  const rangeText = (r) => {
    const year = state.today ? state.today.slice(0, 4) : '';
    return r.dateFrom === r.dateTo ? formatDate(r.dateFrom, year) : t('unavail.range', { from: formatDate(r.dateFrom, year), to: formatDate(r.dateTo, year) });
  };

  function render() {
    $('unavail-empty').hidden = state.ranges.length > 0;
    $('unavail-list').replaceChildren(...state.ranges.map((r) => el('li', { class: 'unavail-row' },
      el('span', { class: 'unavail-when', text: rangeText(r) }),
      r.note ? el('span', { class: 'muted', text: r.note }) : null,
      el('button', { type: 'button', class: 'secondary icon-button', 'aria-label': t('unavail.remove', { when: rangeText(r) }), onclick: () => remove(r) }, el('span', { 'aria-hidden': 'true', text: '✕' })))));
  }

  async function remove(r) {
    const res = await api(`/api/me/unavailability/${r.id}`, { method: 'DELETE' });
    if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
    state.ranges = res.body.ranges;
    say(t('unavail.removed'), 'success');
    render();
  }

  $('unavail-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    say('');
    const res = await api('/api/me/unavailability', { method: 'POST', body: { dateFrom: $('u-from').value, dateTo: $('u-to').value || $('u-from').value, note: $('u-note').value } });
    if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
    state.ranges = res.body.ranges;
    $('unavail-form').reset();
    say(t('unavail.added'), 'success');
    render();
  });

  document.addEventListener('i18n:change', render);

  api('/api/me/unavailability').then((res) => {
    if (!res.ok) return;
    state.ranges = res.body.ranges;
    state.today = res.body.today;
    $('u-from').min = state.today;
    $('unavail').hidden = false;
    render();
  }).catch(() => {});
})();
