'use strict';

// /offline: what the installed app shows for a page it has not cached, without network.
document.getElementById('retry').addEventListener('click', () => window.location.reload());
window.addEventListener('online', () => window.location.reload());
