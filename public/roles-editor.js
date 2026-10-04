'use strict';

// Echipa → Roluri (the owner): the built-in roles with their rights (read-only) and the roles
// the owner creates (lib/roles.js): name, emoji, "Se deschide ca" (the page an event opens
// on) and the rights, ticked one by one. Mounted with ROLES_EDITOR.mount(container,
// { onChange(roles) }); everything through /api/roles.

(function () {
  const { api, el, ROLE_EMOJI } = window.PAGE;
  const { t } = window.I18N;

  const PERMS = ['library', 'events', 'media', 'live', 'screens', 'schedule', 'guides']; // lib/roles.js
  const BUILTIN = {
    owner: PERMS,
    presenter: ['library', 'events', 'media', 'live'],
    leader: ['library', 'events', 'media', 'live', 'schedule', 'guides'],
    operator: ['library', 'events', 'media', 'live', 'screens'],
    member: [],
  };
  const BASES = ['presenter', 'leader', 'operator', 'member'];

  const permsText = (perms) => (perms.length === PERMS.length ? t('customRoles.everything')
    : perms.length ? perms.map((p) => t(`customRoles.permsShort.${p}`)).join(' · ') : t('customRoles.noRights'));
  const peopleText = (n) => (n === 0 ? t('customRoles.peopleZero') : n === 1 ? t('customRoles.peopleOne') : t('customRoles.people', { n }));
  const label = (role) => (role.emoji ? `${role.emoji} ${role.name}` : role.name);

  function mount(root, { onChange } = {}) {
    // editing: a custom role (or null for a new one); builtin: the built-in role being edited
    const state = { roles: [], builtins: [], editing: null, builtin: null, confirming: false };
    const builtIn = el('ul', { class: 'roles-list roles-builtin' });
    const mine = el('ul', { class: 'roles-list', id: 'roles-mine' });
    const empty = el('p', { class: 'muted', id: 'roles-empty', hidden: true });
    const message = el('p', { class: 'message', id: 'roles-message', role: 'status', 'aria-live': 'polite' });
    const addButton = el('button', { type: 'button', id: 'role-add', 'data-icon': 'plus', onclick: () => open(null) });
    const builtInHeading = el('h2', { class: 'team-panel-heading' });
    const mineHeading = el('h2', { class: 'team-panel-heading' });
    const intro = el('p', { class: 'hint' });

    // the dialog
    const nameInput = el('input', { type: 'text', id: 'role-name', maxlength: '40', autocomplete: 'off', required: 'required' });
    const emojiInput = el('input', { type: 'text', id: 'role-emoji', class: 'position-emoji-input', maxlength: '16', autocomplete: 'off' });
    const nameLabel = el('span');
    const emojiLabel = el('span');
    const baseLegend = el('legend');
    const baseHelp = el('p', { class: 'hint' });
    const baseInputs = BASES.map((base) => el('input', { type: 'radio', name: 'role-base', value: base }));
    const baseTexts = BASES.map(() => el('span'));
    const permsLegend = el('legend');
    const permInputs = PERMS.map((perm) => el('input', { type: 'checkbox', name: 'role-perm', value: perm }));
    const permTexts = PERMS.map(() => el('span'));
    const permsNote = el('p', { class: 'hint', id: 'role-perms-note' });
    const dialogHeading = el('h2', { id: 'role-heading' });
    const dialogMessage = el('p', { class: 'message error', id: 'role-message', role: 'alert' });
    const saveButton = el('button', { type: 'submit', id: 'role-save', 'data-icon': 'check' });
    const cancelButton = el('button', { type: 'button', class: 'secondary', id: 'role-cancel', onclick: () => dialog.close() });
    const deleteButton = el('button', { type: 'button', class: 'secondary danger-text', id: 'role-delete', 'data-icon': 'close', onclick: () => { state.confirming = true; renderDialog(); } });
    const confirmText = el('p', { id: 'role-delete-text' });
    const confirmYes = el('button', { type: 'button', class: 'danger', id: 'role-delete-yes', onclick: () => remove() });
    const confirmNo = el('button', { type: 'button', class: 'secondary', id: 'role-delete-no', onclick: () => { state.confirming = false; renderDialog(); } });
    const confirmBox = el('div', { class: 'role-delete-confirm', hidden: true }, confirmText, el('div', { class: 'form-actions' }, confirmYes, confirmNo));
    const resetButton = el('button', { type: 'button', class: 'secondary', id: 'role-reset', 'data-icon': 'restart', onclick: () => resetBuiltin() });
    const builtinNote = el('p', { class: 'hint', id: 'role-builtin-note' });
    const nameHint = el('p', { class: 'hint', id: 'role-name-hint' });
    const form = el('form', { id: 'role-form', method: 'dialog', novalidate: 'novalidate' },
      dialogHeading,
      el('div', { class: 'field-row role-name-row' },
        el('label', { class: 'field role-name-field' }, nameLabel, nameInput),
        el('label', { class: 'field' }, emojiLabel, emojiInput)),
      nameHint, builtinNote,
      el('fieldset', { class: 'role-choice', id: 'role-base-choice' }, baseLegend, baseHelp,
        ...BASES.map((base, i) => el('label', { class: 'role-option' }, baseInputs[i], el('span', null, el('strong', null, el('span', { class: 'role-emoji', 'aria-hidden': 'true', text: ROLE_EMOJI[base] }), ' ', baseTexts[i]))))),
      el('fieldset', { class: 'positions-choice' }, permsLegend,
        el('div', { class: 'checkbox-list' }, ...PERMS.map((perm, i) => el('label', { class: 'checkbox' }, permInputs[i], permTexts[i]))),
        permsNote),
      dialogMessage,
      el('div', { class: 'form-actions' }, saveButton, cancelButton, deleteButton, resetButton),
      confirmBox);
    const dialog = el('dialog', { id: 'role-dialog', 'aria-labelledby': 'role-heading' }, form);

    root.replaceChildren(intro, builtInHeading, builtIn, mineHeading, mine, empty, el('div', { class: 'roles-actions' }, addButton), message, dialog);

    function say(text, kind) {
      message.className = `message${kind ? ` ${kind}` : ''}`;
      message.textContent = text || '';
    }

    // 'screens' needs 'live' (the console sends live commands): ticking it ticks Live too.
    permInputs[PERMS.indexOf('screens')].addEventListener('change', (event) => {
      if (event.target.checked) permInputs[PERMS.indexOf('live')].checked = true;
    });
    permInputs[PERMS.indexOf('live')].addEventListener('change', (event) => {
      if (!event.target.checked) permInputs[PERMS.indexOf('screens')].checked = false;
    });

    function row(role) {
      return el('li', { class: 'role-row', 'data-role': String(role.id) },
        el('div', { class: 'role-main' },
          el('p', { class: 'role-name', text: label(role) }),
          el('p', { class: 'role-meta muted', text: `${t(`customRoles.bases.${role.base}`)} · ${peopleText(role.users || 0)}` }),
          el('p', { class: 'role-perms', text: permsText(role.perms) })),
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'edit', text: t('customRoles.edit'), 'aria-label': t('customRoles.editLabel', { name: role.name }), onclick: () => open(role) }));
    }

    function render() {
      intro.textContent = t('customRoles.intro');
      builtInHeading.textContent = t('customRoles.builtInHeading');
      mineHeading.textContent = t('customRoles.mineHeading');
      empty.textContent = t('customRoles.empty');
      addButton.textContent = t('customRoles.add');
      // the owner: fixed; the four others: editable (name, emoji, rights)
      builtIn.replaceChildren(
        el('li', { class: 'role-row builtin', 'data-builtin': 'owner' },
          el('div', { class: 'role-main' },
            el('p', { class: 'role-name', text: window.PAGE.roleLabel('owner') }),
            el('p', { class: 'role-perms', text: `${permsText(BUILTIN.owner)} · ${t('customRoles.ownerFixed')}` }))),
        ...BASES.map((role) => {
          const b = state.builtins.find((x) => x.role === role) || { role, perms: BUILTIN[role], customized: false, users: 0 };
          return el('li', { class: 'role-row builtin', 'data-builtin': role },
            el('div', { class: 'role-main' },
              el('p', { class: 'role-name', text: window.PAGE.roleLabel(role) }, b.customized ? el('span', { class: 'muted', text: ` · ${t('customRoles.customized')}` }) : null),
              el('p', { class: 'role-meta muted', text: peopleText(b.users || 0) }),
              el('p', { class: 'role-perms', text: permsText(b.perms) })),
            el('button', { type: 'button', class: 'secondary', 'data-icon': 'edit', 'data-edit-builtin': role, text: t('customRoles.edit'), 'aria-label': t('customRoles.editLabel', { name: window.PAGE.roleName(role) }), onclick: () => openBuiltin(b) }));
        }));
      mine.replaceChildren(...state.roles.map(row));
      empty.hidden = state.roles.length > 0;
      renderDialog();
    }

    function renderDialog() {
      const role = state.editing;
      const b = state.builtin;
      dialogHeading.textContent = t(role || b ? 'customRoles.dialogEdit' : 'customRoles.dialogNew');
      nameLabel.textContent = t('customRoles.nameLabel');
      nameInput.placeholder = b ? t(`team.roles.${b.role}`) : t('customRoles.namePlaceholder');
      emojiInput.placeholder = b ? window.PAGE.ROLE_EMOJI[b.role] : '';
      nameInput.required = !b;
      nameHint.hidden = !b;
      builtinNote.hidden = !b;
      form.querySelector('#role-base-choice').hidden = Boolean(b);
      if (b) {
        nameHint.textContent = t('customRoles.nameDefault', { name: t(`team.roles.${b.role}`) });
        builtinNote.textContent = t('customRoles.builtinNote', { base: t(`customRoles.bases.${b.role}`) });
      }
      resetButton.textContent = t('customRoles.resetDefault');
      resetButton.hidden = !b || !b.customized;
      emojiLabel.textContent = t('customRoles.emojiLabel');
      baseLegend.textContent = t('customRoles.baseLabel');
      baseHelp.textContent = t('customRoles.baseHelp');
      BASES.forEach((base, i) => { baseTexts[i].textContent = t(`customRoles.bases.${base}`); });
      permsLegend.textContent = t('customRoles.permsLabel');
      PERMS.forEach((perm, i) => { permTexts[i].textContent = t(`customRoles.perms.${perm}`); });
      permsNote.textContent = t('customRoles.screensNeedsLive');
      saveButton.textContent = t('customRoles.save');
      cancelButton.textContent = t('customRoles.cancel');
      deleteButton.textContent = t('customRoles.delete');
      deleteButton.hidden = !role || Boolean(b) || state.confirming;
      confirmBox.hidden = !role || !state.confirming;
      if (role) confirmText.textContent = t('customRoles.deleteConfirm', { name: role.name, people: peopleText(role.users || 0) });
      confirmYes.textContent = t('customRoles.deleteYes');
      confirmNo.textContent = t('customRoles.cancel');
    }

    // A built-in role: its name / emoji (empty = the default) and its rights.
    function openBuiltin(b) {
      state.editing = null;
      state.builtin = b;
      state.confirming = false;
      nameInput.value = b.name || '';
      emojiInput.value = b.emoji || '';
      permInputs.forEach((input) => { input.checked = b.perms.includes(input.value); });
      dialogMessage.textContent = '';
      renderDialog();
      dialog.showModal();
      nameInput.focus();
    }

    // role -> { name, emoji } of the renamed built-in roles, for every label on the page
    const namesOf = (builtins) => Object.fromEntries(builtins.filter((x) => x.name || x.emoji).map((x) => [x.role, { name: x.name, emoji: x.emoji }]));

    async function resetBuiltin() {
      const b = state.builtin;
      const res = await api(`/api/roles/builtin/${b.role}`, { method: 'DELETE' });
      if (!res.ok) { dialogMessage.textContent = res.body.error || t('common.networkError'); return; }
      dialog.close();
      changed(res.body, t('customRoles.resetDone', { name: t(`team.roles.${b.role}`) }));
    }

    function open(role) {
      state.builtin = null;
      state.editing = role;
      state.confirming = false;
      nameInput.value = role ? role.name : '';
      emojiInput.value = role && role.emoji ? role.emoji : '';
      const base = role ? role.base : 'member';
      baseInputs.forEach((input) => { input.checked = input.value === base; });
      const perms = role ? role.perms : [];
      permInputs.forEach((input) => { input.checked = perms.includes(input.value); });
      dialogMessage.textContent = '';
      renderDialog();
      dialog.showModal();
      nameInput.focus();
    }

    function changed(body, text) {
      state.roles = body.roles;
      if (body.builtins) {
        state.builtins = body.builtins;
        window.PAGE.setRoleNames(namesOf(state.builtins));
      }
      render();
      say(text, 'success');
      if (onChange) onChange(state.roles);
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const checked = baseInputs.find((input) => input.checked);
      const body = {
        name: nameInput.value,
        emoji: emojiInput.value,
        base: checked ? checked.value : 'member',
        perms: permInputs.filter((input) => input.checked).map((input) => input.value),
      };
      saveButton.disabled = true;
      try {
        if (state.builtin) {
          const b = state.builtin;
          const res = await api(`/api/roles/builtin/${b.role}`, { method: 'PUT', body: { name: body.name, emoji: body.emoji, perms: body.perms } });
          if (!res.ok) { dialogMessage.textContent = res.body.error || t('common.networkError'); return; }
          dialog.close();
          changed(res.body, t('customRoles.saved', { name: res.body.builtin.name || t(`team.roles.${b.role}`) }));
          return;
        }
        const role = state.editing;
        const res = await api(role ? `/api/roles/${role.id}` : '/api/roles', { method: role ? 'PUT' : 'POST', body });
        if (!res.ok) { dialogMessage.textContent = res.body.error || t('common.networkError'); return; }
        dialog.close();
        changed(res.body, t('customRoles.saved', { name: res.body.role.name }));
      } catch (err) {
        dialogMessage.textContent = t('common.networkError');
      } finally {
        saveButton.disabled = false;
      }
    });

    async function remove() {
      const role = state.editing;
      confirmYes.disabled = true;
      try {
        const res = await api(`/api/roles/${role.id}`, { method: 'DELETE' });
        if (!res.ok) { dialogMessage.textContent = res.body.error || t('common.networkError'); return; }
        dialog.close();
        changed(res.body, t('customRoles.deleted', { name: role.name }));
      } finally {
        confirmYes.disabled = false;
      }
    }

    async function load() {
      const res = await api('/api/roles');
      if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
      state.roles = res.body.roles;
      state.builtins = res.body.builtins || [];
      window.PAGE.setRoleNames(namesOf(state.builtins));
      render();
      if (onChange) onChange(state.roles);
    }

    document.addEventListener('i18n:change', render);
    render();
    load().catch(() => say(t('common.networkError'), 'error'));
    return { reload: load };
  }

  window.ROLES_EDITOR = { mount };
})();
