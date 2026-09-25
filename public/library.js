'use strict';

// /library: ONE search field (public/song-search.js): typing filters the library under
// "Din bibliotecă"; owner and leader can also search resursecrestine.ro with Enter or
// "Caută și pe resurse". Import / export of the whole library live in the "⋯" menu of the
// header (public/library-import.js).

(function () {
  const { api, canEdit } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);

  // The search itself: public/song-search.js, on this page's markup (#q, #songs, …).
  const search = window.SONG_SEARCH.create(document.querySelector('main'), { mode: 'library' });

  // Keep the search in the URL so Back from a song returns to the same results.
  const params = new URLSearchParams(window.location.search);
  $('q').value = params.get('q') || '';
  if (['az', 'za', 'recent'].includes(params.get('sort'))) $('sort').value = params.get('sort');

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
    menu.hidden = !canEdit(me);
    search.setMe(me);
    search.setOnline(canEdit(me));
    search.reload();
  })().catch(() => {
    $('status').removeAttribute('data-i18n');
    $('status').textContent = t('common.networkError');
  });
})();
