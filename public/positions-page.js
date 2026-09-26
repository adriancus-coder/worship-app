'use strict';

// /positions ("Poziții în echipă", owner and leader): the shared editor (public/positions-editor.js).
(function () {
  window.PAGE.setTitle('positions.pageTitle');
  document.addEventListener('i18n:change', () => window.PAGE.setTitle('positions.pageTitle'));
  window.POSITIONS_EDITOR.mount(document.getElementById('positions-editor'));
})();
