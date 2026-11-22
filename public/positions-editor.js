'use strict';

// "Poziții în echipă": the positions a church uses (lib/positions.js), edited by the owner
// (Echipa → Poziții): add (the emoji guessed from the name), rename and change the emoji
// inline, move up / down, deactivate / reactivate. Mounted with POSITIONS_EDITOR.mount(container); everything through
// /api/positions.

(function () {
  const { api, el } = window.PAGE;
  const { t } = window.I18N;

  function mount(root) {
    const state = { positions: [], canManage: false, editing: null, people: {}, members: [], picking: null }; // people: position id -> [{ id, name }]; picking: the position whose people are chosen
    const list = el('ol', { class: 'positions-list' });
    const message = el('p', { class: 'message', role: 'status', 'aria-live': 'polite' });
    const input = el('input', { type: 'text', maxlength: '40', autocomplete: 'off', 'aria-label': t('positions.newLabel') });
    const addButton = el('button', { type: 'submit', class: 'secondary', 'data-icon': 'plus', text: t('positions.add') });
    const form = el('form', { class: 'positions-add', novalidate: 'novalidate' }, input, addButton);
    // "Persoane": who has the position, ticked; saved as the profile would (PUT .../people)
    const pickHeading = el('h2', { id: 'position-people-heading' });
    const pickList = el('div', { class: 'checkbox-list', id: 'position-people-list' });
    const pickMessage = el('p', { class: 'message error', role: 'alert' });
    const pickSave = el('button', { type: 'submit', id: 'position-people-save', 'data-icon': 'check' });
    const pickCancel = el('button', { type: 'button', class: 'secondary', onclick: () => pickDialog.close() });
    const pickForm = el('form', { method: 'dialog', novalidate: 'novalidate' }, pickHeading, el('p', { class: 'hint', id: 'position-people-hint' }), pickList, pickMessage, el('div', { class: 'form-actions' }, pickSave, pickCancel));
    const pickDialog = el('dialog', { id: 'position-people-dialog', 'aria-labelledby': 'position-people-heading' }, pickForm);
    pickDialog.addEventListener('click', (event) => { if (event.target === pickDialog) pickDialog.close(); });
    root.replaceChildren(list, form, message, pickDialog);

    function openPeople(p) {
      state.picking = p;
      const have = new Set((state.people[p.id] || []).map((u) => u.id));
      pickHeading.textContent = t('positions.peopleHeading', { name: p.name });
      pickForm.querySelector('#position-people-hint').textContent = t('positions.peopleHint');
      pickList.replaceChildren(...state.members.map((u) => el('label', { class: 'checkbox' },
        el('input', { type: 'checkbox', name: 'position-person', value: String(u.id), checked: have.has(u.id) ? 'checked' : null }),
        el('span', { text: u.name }))));
      pickSave.textContent = t('positions.peopleSave');
      pickCancel.textContent = t('positions.cancel');
      pickMessage.textContent = '';
      pickDialog.showModal();
    }

    pickForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const p = state.picking;
      const userIds = [...pickList.querySelectorAll('input:checked')].map((box) => Number(box.value));
      pickSave.disabled = true;
      try {
        const res = await api(`/api/positions/${p.id}/people`, { method: 'PUT', body: { userIds } });
        if (!res.ok) { pickMessage.textContent = res.body.error || t('common.networkError'); return; }
        take(res.body);
        pickDialog.close();
        say(t('positions.peopleSaved', { name: p.name, n: userIds.length }), 'success');
        document.dispatchEvent(new CustomEvent('positions:people', { detail: { positionId: p.id } }));
      } finally {
        pickSave.disabled = false;
      }
    });

    // the server's answer: the positions, who has each, everyone to pick from
    function take(body) {
      state.positions = body.positions;
      if (body.people) state.people = body.people;
      if (body.members) state.members = body.members;
      render();
    }

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
      take(res.body);
      return res.body;
    }

    function row(p, index) {
      const editing = state.editing === p.id;
      const name = editing
        ? el('input', { type: 'text', class: 'position-rename', value: p.name, maxlength: '40', 'aria-label': t('positions.renameLabel', { name: p.name }) })
        : el('span', { class: `position-name${p.active ? '' : ' inactive'}`, text: p.name });
      const emoji = editing
        ? el('input', { type: 'text', class: 'position-emoji-input', value: p.emoji || '', maxlength: '16', autocomplete: 'off', inputmode: 'text', 'aria-label': t('positions.emojiLabel', { name: p.name }) })
        : el('span', { class: 'position-emoji', 'aria-hidden': 'true', text: p.emoji || '' });
      const tools = el('span', { class: 'position-tools' });
      // who has this position in their profile: "Ana, Bob" / "nimeni în profil"
      const names = (state.people[p.id] || []).map((u) => u.name);
      const people = el('span', { class: `position-people${names.length ? '' : ' muted'}`, text: names.length ? names.join(', ') : t('positions.nobody') });
      const text = el('span', { class: 'position-text' }, name, editing ? null : people);
      if (!state.canManage) return el('li', { class: 'position-row' }, emoji, text, p.active ? null : el('span', { class: 'pill status-pill status-inactive', text: t('positions.inactive') }));
      if (editing) {
        const save = async () => {
          const value = name.value.trim();
          if (!value) return;
          const icon = emoji.value.trim();
          const patch = {};
          if (value !== p.name) patch.name = value;
          if (icon !== (p.emoji || '')) patch.emoji = icon;
          if (Object.keys(patch).length && !(await change(`/api/positions/${p.id}`, 'PUT', patch))) return;
          state.editing = null;
          render();
        };
        for (const field of [name, emoji]) field.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } if (event.key === 'Escape') { state.editing = null; render(); } });
        tools.append(
          el('button', { type: 'button', 'data-icon': 'check', text: t('positions.save'), onclick: save }),
          el('button', { type: 'button', class: 'secondary', text: t('positions.cancel'), onclick: () => { state.editing = null; render(); } }));
      } else {
        tools.append(
          el('button', { type: 'button', class: 'secondary position-people-button', 'data-icon': 'person-plus', text: t('positions.people'), 'aria-label': t('positions.peopleLabel', { name: p.name }), onclick: () => openPeople(p) }),
          el('button', { type: 'button', class: 'secondary icon-button', 'aria-label': t('positions.moveUp', { name: p.name }), disabled: index === 0 ? 'disabled' : null, onclick: () => move(index, -1) }, el('span', { 'aria-hidden': 'true', text: '↑' })),
          el('button', { type: 'button', class: 'secondary icon-button', 'aria-label': t('positions.moveDown', { name: p.name }), disabled: index === state.positions.length - 1 ? 'disabled' : null, onclick: () => move(index, 1) }, el('span', { 'aria-hidden': 'true', text: '↓' })),
          el('button', { type: 'button', class: 'secondary', 'data-icon': 'edit', text: t('positions.rename'), 'aria-label': t('positions.renameLabel', { name: p.name }), onclick: () => { state.editing = p.id; render(); root.querySelector('.position-rename').select(); } }),
          p.active
            ? el('button', { type: 'button', class: 'secondary danger-text', 'data-icon': 'close', text: t('positions.deactivate'), 'aria-label': t('positions.deactivateLabel', { name: p.name }), onclick: () => change(`/api/positions/${p.id}`, 'PUT', { active: false }) })
            : el('button', { type: 'button', class: 'secondary', 'data-icon': 'restart', text: t('positions.reactivate'), 'aria-label': t('positions.reactivateLabel', { name: p.name }), onclick: () => change(`/api/positions/${p.id}`, 'PUT', { active: true }) }));
      }
      return el('li', { class: `position-row${p.active ? '' : ' inactive'}`, 'data-position': String(p.id) }, emoji, text,
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
      state.canManage = res.body.canManage;
      take(res.body);
    }

    document.addEventListener('i18n:change', render);
    load().catch(() => say(t('common.networkError'), 'error'));
    return { reload: load };
  }

  window.POSITIONS_EDITOR = { mount };
})();
