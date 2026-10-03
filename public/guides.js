'use strict';

// Ghiduri (/guides): the church's how-to guides (lib/guides.js). Everyone reads; with the
// 'guides' right "Ghid nou" makes one (title, emoji, summary, the positions it is for) and
// opens it for editing. "Pentru pozițiile mele" / "Toate": a person with positions sees theirs
// first; guides for no position are for everyone and always shown.

(function () {
  const { api, el, positionLabel } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const state = { guides: [], positions: [], mine: [], canEdit: false, filter: 'mine' };

  function say(text, kind) {
    $('page-message').className = `message${kind ? ` ${kind}` : ''}`;
    $('page-message').textContent = text || '';
  }

  const posName = (id) => { const p = state.positions.find((x) => x.id === id); return p ? positionLabel(p) : null; };
  const isMine = (g) => !g.positionIds.length || g.positionIds.some((id) => state.mine.includes(id));

  function render() {
    window.PAGE.setTitle('guides.pageTitle');
    const hasMine = state.mine.length > 0;
    $('guides-filter').hidden = !hasMine;
    for (const b of $('guides-filter').querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter));
    const shown = state.guides.filter((g) => !hasMine || state.filter === 'all' || isMine(g));
    $('guides-status').hidden = shown.length > 0;
    if (!shown.length) $('guides-status').textContent = t(state.canEdit ? 'guides.emptyEditor' : 'guides.empty');
    $('guides-list').replaceChildren(...shown.map((g) => el('li', null,
      el('a', { class: 'guide-row', href: `/guides/${g.id}`, 'data-guide': String(g.id) },
        el('span', { class: 'guide-emoji', 'aria-hidden': 'true', text: g.emoji || '📘' }),
        el('span', { class: 'guide-text' },
          el('span', { class: 'guide-title', text: g.title }),
          g.summary ? el('span', { class: 'guide-summary', text: g.summary }) : null,
          el('span', { class: 'guide-meta', text: `${g.positionIds.length ? t('guides.forPositions', { positions: g.positionIds.map(posName).filter(Boolean).join(', ') }) : t('guides.everyone')} · ${t('guides.counts', { steps: g.steps, problems: g.problems })}` })),
        el('span', { class: 'person-chevron', 'aria-hidden': 'true', text: '›' })))));
    $('guide-add').hidden = !state.canEdit;
  }

  for (const b of $('guides-filter').querySelectorAll('[data-filter]')) {
    b.addEventListener('click', () => { state.filter = b.dataset.filter; render(); });
  }

  // "Ghid nou"
  $('guide-add').addEventListener('click', () => {
    $('g-title').value = '';
    $('g-emoji').value = '';
    $('g-summary').value = '';
    $('g-title').placeholder = t('guides.titlePlaceholder');
    $('g-summary').placeholder = t('guides.summaryPlaceholder');
    $('g-positions').replaceChildren(...state.positions.filter((p) => p.active).map((p) => el('label', { class: 'checkbox' },
      el('input', { type: 'checkbox', name: 'g-position', value: String(p.id) }), el('span', { text: positionLabel(p) }))));
    $('guide-message').textContent = '';
    $('guide-dialog').showModal();
    $('g-title').focus();
  });
  for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());

  $('guide-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('g-create').disabled = true;
    try {
      const positionIds = [...document.querySelectorAll('#g-positions input:checked')].map((x) => Number(x.value));
      const res = await api('/api/guides', { method: 'POST', body: { title: $('g-title').value, emoji: $('g-emoji').value, summary: $('g-summary').value, positionIds } });
      if (!res.ok) { $('guide-message').textContent = res.body.error || t('common.networkError'); return; }
      window.location.assign(`/guides/${res.body.guide.id}?edit=1`);
    } finally {
      $('g-create').disabled = false;
    }
  });

  async function load() {
    const [list, positions, profile] = await Promise.all([api('/api/guides'), api('/api/positions'), api('/api/me/profile')]);
    if (!list.ok) { $('guides-status').textContent = list.body.error || t('common.networkError'); return; }
    state.guides = list.body.guides;
    state.canEdit = list.body.canEdit;
    state.positions = positions.ok ? positions.body.positions : [];
    state.mine = profile.ok ? profile.body.profile.positionIds : [];
    const gone = new URLSearchParams(window.location.search).get('deleted');
    if (gone) say(t('guides.deleted', { title: gone }), 'success');
    render();
  }

  document.addEventListener('i18n:change', render);
  load().catch(() => { $('guides-status').textContent = t('common.networkError'); });
})();
