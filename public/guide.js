'use strict';

// One guide (/guides/:id, lib/guides.js). Reading: the numbered steps, each with its text and
// photo and a "Făcut" box (this device only, kept until "Începe din nou": a checklist to
// follow in front of the mixer), then "Dacă nu merge": each problem opens to its fix.
// With the 'guides' right "Editează ghidul" (or ?edit=1 after "Ghid nou") turns the same page
// into the editor: the details, each item's title / text / photo, order, delete, and the
// "Adaugă un pas" / "Adaugă o problemă" forms.

(function () {
  const { api, el, positionLabel } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const id = Number((window.location.pathname.match(/^\/guides\/(\d+)/) || [])[1]);
  const DONE_KEY = `guide-done-${id}`;
  const state = { guide: null, items: [], canEdit: false, ai: false, positions: [], editing: false, removing: null, deleting: false, done: new Set() };

  try { state.done = new Set(JSON.parse(window.localStorage.getItem(DONE_KEY) || '[]')); } catch (err) { state.done = new Set(); }
  const saveDone = () => { try { window.localStorage.setItem(DONE_KEY, JSON.stringify([...state.done])); } catch (err) { /* this device only */ } };

  function say(text, kind) {
    $('guide-message').className = `message${kind ? ` ${kind}` : ''}`;
    $('guide-message').textContent = text || '';
  }

  // Every write answers with the whole guide: keep it and draw again.
  async function change(url, method, body, okText) {
    const res = await api(url, { method, body });
    if (!res.ok) { say(res.body.error || t('common.networkError'), 'error'); return null; }
    if (res.body.guide) { state.guide = res.body.guide; state.items = res.body.items; }
    say(okText || '', okText ? 'success' : '');
    render();
    return res.body;
  }

  const steps = () => state.items.filter((i) => i.kind === 'step');
  const problems = () => state.items.filter((i) => i.kind === 'problem');
  const posName = (pid) => { const p = state.positions.find((x) => x.id === pid); return p ? positionLabel(p) : null; };

  // --- reading -------------------------------------------------------------------------------
  function photo(item) {
    return item.image ? el('img', { class: 'guide-photo', src: item.image, alt: t('guides.photoAlt', { title: item.title }), loading: 'lazy' }) : null;
  }

  function readStep(item, n) {
    const done = state.done.has(item.id);
    return el('li', { class: `guide-item guide-step${done ? ' done' : ''}`, 'data-item': String(item.id) },
      el('div', { class: 'guide-item-head' },
        el('span', { class: 'guide-step-n', text: t('guides.stepN', { n }) }),
        el('label', { class: 'checkbox guide-done' },
          el('input', { type: 'checkbox', checked: done ? 'checked' : null, 'aria-label': t('guides.doneLabel', { n }), onchange: (e) => { if (e.target.checked) state.done.add(item.id); else state.done.delete(item.id); saveDone(); render(); } }),
          el('span', { text: t('guides.done') }))),
      el('h3', { class: 'guide-item-title', text: item.title }),
      item.body ? el('p', { class: 'guide-body', text: item.body }) : null,
      photo(item));
  }

  function readProblem(item) {
    return el('li', { class: 'guide-item guide-problem', 'data-item': String(item.id) },
      el('details', null,
        el('summary', { text: item.title }),
        item.body ? el('p', { class: 'guide-body', text: item.body }) : null,
        photo(item)));
  }

  // --- editing -------------------------------------------------------------------------------
  function photoControls(item) {
    const input = el('input', { type: 'file', accept: 'image/*', class: 'sr-only', 'data-photo': String(item.id) });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      say(t('guides.photoUploading'));
      try {
        const res = await fetch(`/api/guides/${id}/items/${item.id}/image`, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return say(body.error || t('common.networkError'), 'error');
        state.guide = body.guide;
        state.items = body.items;
        say(t('guides.saved'), 'success');
        render();
      } catch (err) {
        say(t('common.networkError'), 'error');
      }
    });
    const pick = el('label', { class: 'button secondary guide-photo-pick', 'data-icon': 'plus' }, input, el('span', { text: t(item.image ? 'guides.photoChange' : 'guides.photo') }));
    return el('div', { class: 'guide-photo-tools' }, pick,
      item.image ? el('button', { type: 'button', class: 'secondary', 'data-icon': 'close', text: t('guides.photoRemove'), onclick: () => change(`/api/guides/${id}/items/${item.id}/image`, 'DELETE') }) : null);
  }

  function move(kind, index, delta) {
    const ids = state.items.filter((i) => i.kind === kind).map((i) => i.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    change(`/api/guides/${id}/order`, 'PUT', { kind, ids });
  }

  function editItem(item, index, list) {
    const title = el('input', { type: 'text', class: 'guide-edit-title', value: item.title, maxlength: '120', 'aria-label': t(item.kind === 'step' ? 'guides.stepTitleLabel' : 'guides.problemTitleLabel') });
    const body = el('textarea', { class: 'guide-edit-body', rows: '3', maxlength: '4000', 'aria-label': t(item.kind === 'step' ? 'guides.bodyLabel' : 'guides.problemBodyLabel') });
    body.value = item.body;
    const removing = state.removing === item.id;
    return el('li', { class: `guide-item guide-edit-item guide-${item.kind}`, 'data-item': String(item.id) },
      item.kind === 'step' ? el('span', { class: 'guide-step-n', text: t('guides.stepN', { n: index + 1 }) }) : null,
      title, body, photo(item), photoControls(item),
      el('div', { class: 'guide-edit-tools' },
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'check', text: t('guides.save'), onclick: () => change(`/api/guides/${id}/items/${item.id}`, 'PUT', { title: title.value, body: body.value }, t('guides.saved')) }),
        el('button', { type: 'button', class: 'secondary icon-button', 'aria-label': t('guides.moveUp', { title: item.title }), disabled: index === 0 ? 'disabled' : null, onclick: () => move(item.kind, index, -1) }, el('span', { 'aria-hidden': 'true', text: '↑' })),
        el('button', { type: 'button', class: 'secondary icon-button', 'aria-label': t('guides.moveDown', { title: item.title }), disabled: index === list.length - 1 ? 'disabled' : null, onclick: () => move(item.kind, index, 1) }, el('span', { 'aria-hidden': 'true', text: '↓' })),
        el('button', { type: 'button', class: 'secondary danger-text', 'data-icon': 'close', text: t('guides.remove'), 'aria-label': t('guides.removeLabel', { title: item.title }), onclick: () => { state.removing = item.id; render(); } })),
      removing ? el('div', { class: 'assign-remove-confirm', role: 'group' },
        el('p', { text: t('guides.removeConfirm', { title: item.title }) }),
        el('div', { class: 'form-actions' },
          el('button', { type: 'button', class: 'danger', 'data-remove-yes': String(item.id), text: t('guides.remove'), onclick: () => { state.removing = null; change(`/api/guides/${id}/items/${item.id}`, 'DELETE'); } }),
          el('button', { type: 'button', class: 'secondary', text: t('guides.cancel'), onclick: () => { state.removing = null; render(); } }))) : null);
  }

  function addForm(kind) {
    const title = el('input', { type: 'text', maxlength: '120', placeholder: t(kind === 'step' ? 'guides.stepTitlePlaceholder' : 'guides.problemTitlePlaceholder'), 'aria-label': t(kind === 'step' ? 'guides.stepTitleLabel' : 'guides.problemTitleLabel') });
    const body = el('textarea', { rows: '2', maxlength: '4000', placeholder: t('guides.bodyPlaceholder'), 'aria-label': t(kind === 'step' ? 'guides.bodyLabel' : 'guides.problemBodyLabel') });
    const form = el('form', { class: 'guide-add-form', novalidate: 'novalidate', 'data-add': kind },
      title, body,
      el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'secondary', 'data-icon': 'plus', text: t(kind === 'step' ? 'guides.addStep' : 'guides.addProblem') })));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!title.value.trim()) return title.focus();
      if (await change(`/api/guides/${id}/items`, 'POST', { kind, title: title.value, body: body.value })) {
        const again = document.querySelector(`[data-add="${kind}"] input`);
        if (again) again.focus();
      }
    });
    return form;
  }

  function renderDetails() {
    const g = state.guide;
    $('d-title').value = g.title;
    $('d-emoji').value = g.emoji || '';
    $('d-summary').value = g.summary || '';
    $('d-positions').replaceChildren(...state.positions.filter((p) => p.active || g.positionIds.includes(p.id)).map((p) => el('label', { class: 'checkbox' },
      el('input', { type: 'checkbox', name: 'd-position', value: String(p.id), checked: g.positionIds.includes(p.id) ? 'checked' : null }), el('span', { text: positionLabel(p) }))));
  }

  $('guide-details').addEventListener('submit', (event) => {
    event.preventDefault();
    const positionIds = [...document.querySelectorAll('#d-positions input:checked')].map((x) => Number(x.value));
    change(`/api/guides/${id}`, 'PUT', { title: $('d-title').value, emoji: $('d-emoji').value, summary: $('d-summary').value, positionIds }, t('guides.saved'));
  });

  $('guide-edit').addEventListener('click', () => {
    state.editing = !state.editing;
    const url = new URL(window.location.href);
    if (state.editing) url.searchParams.set('edit', '1'); else url.searchParams.delete('edit');
    window.history.replaceState(null, '', url);
    say('');
    if (state.editing) renderDetails();
    render();
  });

  // ✨ "Întreabă ghidul": the answer comes from this guide only (lib/ai.js)
  $('guide-ask').addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = $('ask-q').value.trim();
    if (!question) return $('ask-q').focus();
    $('ask-go').disabled = true;
    $('ask-status').className = 'message';
    $('ask-status').textContent = t('guides.askWorking');
    $('ask-answer').hidden = true;
    $('ask-note').hidden = true;
    try {
      const res = await api(`/api/guides/${id}/ask`, { method: 'POST', body: { question } });
      if (!res.ok) {
        $('ask-status').className = 'message error';
        $('ask-status').textContent = res.body.error || t('common.networkError');
        return;
      }
      $('ask-status').textContent = res.body.covered ? '' : t('guides.askNotCovered');
      $('ask-answer').textContent = res.body.answer;
      $('ask-answer').hidden = false;
      $('ask-note').hidden = false;
    } catch (err) {
      $('ask-status').className = 'message error';
      $('ask-status').textContent = t('common.networkError');
    } finally {
      $('ask-go').disabled = false;
    }
  });

  $('guide-restart').addEventListener('click', () => { state.done.clear(); saveDone(); render(); });

  function renderDelete() {
    const g = state.guide;
    $('guide-delete').replaceChildren(state.deleting
      ? el('div', { class: 'assign-remove-confirm', role: 'group' },
        el('p', { text: t('guides.deleteConfirm', { title: g.title }) }),
        el('div', { class: 'form-actions' },
          el('button', { type: 'button', class: 'danger', id: 'guide-delete-yes', text: t('guides.deleteYes'), onclick: async () => {
            const res = await api(`/api/guides/${id}`, { method: 'DELETE' });
            if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
            window.location.assign(`/guides?deleted=${encodeURIComponent(g.title)}`);
          } }),
          el('button', { type: 'button', class: 'secondary', text: t('guides.cancel'), onclick: () => { state.deleting = false; render(); } })))
      : el('button', { type: 'button', class: 'secondary danger-text', id: 'guide-delete-ask', 'data-icon': 'close', text: t('guides.deleteGuide'), onclick: () => { state.deleting = true; render(); } }));
  }

  function render() {
    const g = state.guide;
    if (!g) return;
    window.PAGE.setTitle('guides.pageTitle');
    document.title = `${g.title} — ${document.documentElement.dataset.appName || ''}`;
    $('guide-title').textContent = `${g.emoji || '📘'} ${g.title}`;
    $('guide-summary').textContent = g.summary || '';
    $('guide-summary').hidden = !g.summary;
    $('guide-for').textContent = g.positionIds.length ? t('guides.forPositions', { positions: g.positionIds.map(posName).filter(Boolean).join(', ') }) : t('guides.everyone');
    $('guide-edit').hidden = !state.canEdit;
    $('guide-edit').textContent = t(state.editing ? 'guides.stopEdit' : 'guides.edit');
    $('guide-edit').dataset.icon = state.editing ? 'check' : 'edit';
    $('guide-details').hidden = !state.editing;
    const s = steps();
    const p = problems();
    if (state.editing) {
      $('steps').replaceChildren(...s.map((item, i) => editItem(item, i, s)));
      $('problems').replaceChildren(...p.map((item, i) => editItem(item, i, p)));
    } else {
      $('steps').replaceChildren(...(s.length ? s.map((item, i) => readStep(item, i + 1)) : [el('li', { class: 'muted', text: t('guides.noSteps') })]));
      $('problems').replaceChildren(...(p.length ? p.map(readProblem) : [el('li', { class: 'muted', text: t('guides.noProblems') })]));
    }
    const done = s.filter((item) => state.done.has(item.id)).length;
    $('guide-progress').textContent = !state.editing && s.length ? t('guides.progress', { done, total: s.length }) : '';
    $('guide-restart').hidden = state.editing || done === 0;
    $('add-step').hidden = !state.editing;
    $('add-problem').hidden = !state.editing;
    if (state.editing) {
      if (!$('add-step').firstChild) $('add-step').replaceChildren(addForm('step'));
      if (!$('add-problem').firstChild) $('add-problem').replaceChildren(addForm('problem'));
      $('add-step').querySelector('input').value = '';
      $('add-step').querySelector('textarea').value = '';
      $('add-problem').querySelector('input').value = '';
      $('add-problem').querySelector('textarea').value = '';
    }
    $('guide-delete').hidden = !state.editing;
    if (state.editing) renderDelete();
    $('guide-ask').hidden = !state.ai || state.editing || !state.items.length;
    $('ask-q').placeholder = t('guides.askPlaceholder');
  }

  async function load() {
    const [res, positions] = await Promise.all([api(`/api/guides/${id}`), api('/api/positions')]);
    if (!res.ok) {
      $('guide-status').removeAttribute('data-i18n');
      $('guide-status').textContent = res.status === 404 ? t('guides.notFound') : (res.body.error || t('common.networkError'));
      return;
    }
    state.guide = res.body.guide;
    state.items = res.body.items;
    state.canEdit = res.body.canEdit;
    state.ai = Boolean(res.body.ai);
    state.positions = positions.ok ? positions.body.positions : [];
    state.editing = state.canEdit && new URLSearchParams(window.location.search).get('edit') === '1';
    $('guide-status').hidden = true;
    $('guide').hidden = false;
    if (state.editing) renderDetails();
    render();
    if (state.editing && !state.items.length) $('add-step').querySelector('input').focus();
  }

  document.addEventListener('i18n:change', () => { $('add-step').replaceChildren(); $('add-problem').replaceChildren(); render(); });
  load().catch(() => { $('guide-status').textContent = t('common.networkError'); });
})();
