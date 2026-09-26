'use strict';

// "Poziții în echipă": the positions a church uses (lib/positions.js), edited by the owner
// (Setări) and the leader (/positions): add, rename inline, move up / down, deactivate /
// reactivate. Mounted with POSITIONS_EDITOR.mount(container); everything through
// /api/positions.

(function () {
  const { api, el } = window.PAGE;
  const { t } = window.I18N;

  function mount(root) {
    const state = { positions: [], canManage: false, editing: null };
    const list = el('ol', { class: 'positions-list' });
    const message = el('p', { class: 'message', role: 'status', 'aria-live': 'polite' });
    const input = el('input', { type: 'text', maxlength: '40', autocomplete: 'off', 'aria-label': t('positions.newLabel') });
    const addButton = el('button', { type: 'submit', class: 'secondary', 'data-icon': 'plus', text: t('positions.add') });
    const form = el('form', { class: 'positions-add', novalidate: 'novalidate' }, input, addButton);
    root.replaceChildren(list, form, message);

    function say(text, kind) {
      message.className = `message${kind ? ` ${kind}` : ''}`;
      message.textContent = text || '';
    }

    async function change(url, method, body) {
      const res = await api(url, { method, body });
      if (!res.ok) {
        say(res.body.error || t('common.networkError'), 'error');
        return null;
      }
      state.positions = res.body.positions;
      render();
      return res.body;
    }

    function row(p, index) {
      const editing = state.editing === p.id;
      const name = editing
        ? el('input', { type: 'text', class: 'position-rename', value: p.name, maxlength: '40', 'aria-label': t('positions.renameLabel', { name: p.name }) })
        : el('span', { class: `position-name${p.active ? '' : ' inactive'}`, text: p.name });
      const tools = el('span', { class: 'position-tools' });
      if (!state.canManage) return el('li', { class: 'position-row' }, name, p.active ? null : el('span', { class: 'pill status-pill status-inactive', text: t('positions.inactive') }));
      if (editing) {
        const save = async () => {
          const value = name.value.trim();
          if (!value) return;
          if (value !== p.name && !(await change(`/api/positions/${p.id}`, 'PUT', { name: value }))) return;
          state.editing = null;
          render();
        };
        name.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } if (event.key === 'Escape') { state.editing = null; render(); } });
        tools.append(
          el('button', { type: 'button', 'data-icon': 'check', text: t('positions.save'), onclick: save }),
          el('button', { type: 'button', class: 'secondary', text: t('positions.cancel'), onclick: () => { state.editing = null; render(); } }));
      } else {
        tools.append(
          el('button', { type: 'button', class: 'secondary icon-button', 'aria-label': t('positions.moveUp', { name: p.name }), disabled: index === 0 ? 'disabled' : null, onclick: () => move(index, -1) }, el('span', { 'aria-hidden': 'true', text: '↑' })),
          el('button', { type: 'button', class: 'secondary icon-button', 'aria-label': t('positions.moveDown', { name: p.name }), disabled: index === state.positions.length - 1 ? 'disabled' : null, onclick: () => move(index, 1) }, el('span', { 'aria-hidden': 'true', text: '↓' })),
          el('button', { type: 'button', class: 'secondary', 'data-icon': 'edit', text: t('positions.rename'), 'aria-label': t('positions.renameLabel', { name: p.name }), onclick: () => { state.editing = p.id; render(); root.querySelector('.position-rename').select(); } }),
          p.active
            ? el('button', { type: 'button', class: 'secondary danger-text', 'data-icon': 'close', text: t('positions.deactivate'), 'aria-label': t('positions.deactivateLabel', { name: p.name }), onclick: () => change(`/api/positions/${p.id}`, 'PUT', { active: false }) })
            : el('button', { type: 'button', class: 'secondary', 'data-icon': 'restart', text: t('positions.reactivate'), 'aria-label': t('positions.reactivateLabel', { name: p.name }), onclick: () => change(`/api/positions/${p.id}`, 'PUT', { active: true }) }));
      }
      return el('li', { class: `position-row${p.active ? '' : ' inactive'}`, 'data-position': String(p.id) }, name,
        p.active ? null : el('span', { class: 'pill status-pill status-inactive', text: t('positions.inactive') }), tools);
    }

    function move(index, delta) {
      const ids = state.positions.map((p) => p.id);
      const [id] = ids.splice(index, 1);
      ids.splice(index + delta, 0, id);
      change('/api/positions/order', 'PUT', { ids });
    }

    function render() {
      list.replaceChildren(...state.positions.map(row));
      form.hidden = !state.canManage;
      input.placeholder = t('positions.newPlaceholder');
      addButton.textContent = t('positions.add');
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      say('');
      if (await change('/api/positions', 'POST', { name })) {
        input.value = '';
        say(t('positions.added', { name }), 'success');
      }
    });

    async function load() {
      const res = await api('/api/positions');
      if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
      state.positions = res.body.positions;
      state.canManage = res.body.canManage;
      render();
    }

    document.addEventListener('i18n:change', render);
    load().catch(() => say(t('common.networkError'), 'error'));
    return { reload: load };
  }

  window.POSITIONS_EDITOR = { mount };
})();
