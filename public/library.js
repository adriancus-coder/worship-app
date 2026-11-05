'use strict';

// /library: ONE search field (public/song-search.js): typing filters the library under
// "Din bibliotecă"; owner, leader and operator can also search resursecrestine.ro with
// Enter or "Caută și pe resurse" and import from there. New songs, editing and the "⋯"
// menu is the owner's. Import / export of the whole library live in the "⋯" menu of the
// header (public/library-import.js).

(function () {
  const { api, canEdit, can } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);

  // The search itself: public/song-search.js, on this page's markup (#q, #songs, …).
  const search = window.SONG_SEARCH.create(document.querySelector('main'), { mode: 'library' });

  // Keep the search in the URL so Back from a song returns to the same results.
  const params = new URLSearchParams(window.location.search);
  $('q').value = params.get('q') || '';
  if (['az', 'za', 'recent'].includes(params.get('sort'))) $('sort').value = params.get('sort');
  if (params.get('noKey') === '1') $('filter-no-key').setAttribute('aria-pressed', 'true'); // "Fără ton"
  search.setTheme(params.get('theme') || ''); // ?theme=Paști (from a song page's chip)
  search.setCollection(params.get('collection') === 'school' ? 'school' : 'main'); // ?collection=school: the Sunday school's library

  // --- "⋯" menu (import / export) ----------------------------------------------------

  const menu = $('library-menu');
  const menuButton = $('library-menu-button');
  const menuList = $('library-menu-list');
  function openMenu(value) {
    menuList.hidden = !value;
    menuButton.setAttribute('aria-expanded', String(value));
    if (value) menuList.querySelector('a, button').focus();
  }
  menuButton.addEventListener('click', () => openMenu(menuList.hidden));
  menuList.addEventListener('click', () => openMenu(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menuList.hidden) {
      openMenu(false);
      menuButton.focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menuList.hidden && !menu.contains(event.target)) openMenu(false);
  });

  (async () => {
    const res = await api('/api/auth/me');
    const me = res.body;
    $('new-song').hidden = !canEdit(me);
    menu.hidden = !(me && me.user && me.user.role === 'owner'); // export / import / the whole-library tools: the owner's
    // a school-only writer sees the school's library first and writes only there
    if (!can(me, 'library') && can(me, 'school') && !params.has('collection')) search.setCollection('school');
    search.onCollection((collection) => {
      $('new-song').href = collection === 'school' ? '/songs/new?collection=school' : '/songs/new';
      $('new-song').hidden = !(can(me, 'library') || (can(me, 'school') && collection === 'school'));
      $('export-library').href = collection === 'school' ? '/api/songs/export?collection=school' : '/api/songs/export';
    });
    search.setMe(me);
    if (window.LIBRARY_IMPORT) window.LIBRARY_IMPORT.setMe(me); // the import's library choice
    // resursecrestine.ro: the event roles (operators import, but never write songs by hand).
    search.setOnline(['library', 'events', 'live'].some((p) => can(me, p))); // routes/resurse.js
    search.reload();
  })().catch(() => {
    $('status').removeAttribute('data-i18n');
    $('status').textContent = t('common.networkError');
  });
})();
