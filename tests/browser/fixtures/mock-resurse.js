// Browser tests only (preloaded with --require): stands in for www.resursecrestine.ro, so the
// library and live search tests never touch the network.
const XML = (title, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<song><title>${title}</title><author>Autor Necunoscut</author><key>G</key>
<presentation>V1 C V2 C B C</presentation>${extra}
<lyrics>[V1]
.G             D
 Ne ridici din noaptea grea
.Em      C
 Tu ești lumina mea
[C]
;de două ori
.C       G/B    Am7
 Sfânt, sfânt e Domnul
[V2]
.G             D
 Isus, Tu ești Domnul meu
[B]
 Aleluia, aleluia || amin
</lyrics></song>`;
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = new URL(url);
  if (!['www.resursecrestine.ro', 'resursecrestine.ro'].includes(u.hostname)) return realFetch(url, opts);
  const res = (status, body, headers = {}) => new Response(body, { status, headers });
  if (u.pathname === '/web-api-search') {
    const q = u.searchParams.get('search_text');
    return res(200, JSON.stringify({ Results: [
      { id: '501', title: `${q} e Domnul`, title_slug: 'isus-e-domnul', author: 'Autor A', slug: 'cantece' },
      { id: '502', title: `${q}, Tu ești lumina`, title_slug: 'isus-tu-esti-lumina', author: '', slug: 'cantece' },
      { id: '9', title: 'Verset', slug: 'versete' },
    ] }), { 'content-type': 'application/json' });
  }
  const m = u.pathname.match(/^\/cantece\/opensong\/(\d+)$/);
  if (m && m[1] === '666') return res(302, '', { location: 'https://evil.example/steal' });
  if (m && m[1] === '404') return res(404, 'nope');
  if (m && m[1] === '777') return res(200, 'x'.repeat(1024 * 1024 + 10));
  if (m && m[1] === '301') return res(301, '', { location: 'https://resursecrestine.ro/cantece/opensong/502' });
  if (m) return res(200, XML(m[1] === '501' ? 'Isus e Domnul' : 'Isus, Tu ești lumina'));
  return res(404, '');
};

// --- chord sheets ("Acorduri") -------------------------------------------------------
// Song 503 ("Fără acorduri") comes without chords; its page lists two sheets: 9001 (the same
// lyrics, chords, key D, "Ref:" on the chorus) and 9002 (another song with this title).
// Songs 501 / 502 have pages with no sheets.
const PLAIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<song><title>Fără acorduri</title><author>Autor Necunoscut</author><key></key><presentation>V1 C</presentation>
<lyrics>[V1]
 Când totul pare că-i pierdut,
 Al meu Păstor îmi va fi scut.
[C]
 Viața mea e-n mâna Sa
 Și cu credință voi cânta
</lyrics></song>`;
const sheetPage = (key, body) => `<html><head><title>x - acorduri: ${key}</title></head><body><div class="resized-text"><span class="stil-acorduri">${body}</span>
</div></body></html>`;
const SHEETS = {
  9001: sheetPage('D', '<a href="#" class="nice-acord" rel="D">D</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<a href="#" class="nice-acord" rel="A">A</a><br />\r\n1. C&acirc;nd&nbsp;totul&nbsp;pare&nbsp;c&#259;-i&nbsp;pierdut,<br />\r\n<a href="#" class="nice-acord" rel="Bm">Bm</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<a href="#" class="nice-acord" rel="G">G</a><br />\r\nAl&nbsp;meu&nbsp;P&#259;stor&nbsp;&icirc;mi&nbsp;va&nbsp;fi&nbsp;scut.<br />\r\n<br />\r\n&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<a href="#" class="nice-acord" rel="G">G</a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<a href="#" class="nice-acord" rel="D">D</a><br />\r\nRef: Via&#539;a&nbsp;mea&nbsp;e-n&nbsp;m&acirc;na&nbsp;Sa<br />\r\n<a href="#" class="nice-acord" rel="A">A</a><br />\r\n&#536;i&nbsp;cu&nbsp;credin&#539;&#259;&nbsp;voi&nbsp;c&acirc;nta<br />\r\n'),
  9002: sheetPage('Am', '<a href="#" class="nice-acord" rel="Am">Am</a><br />\r\nIn&nbsp;dragostea&nbsp;Ta&nbsp;m-ai&nbsp;cuprins<br />\r\n<a href="#" class="nice-acord" rel="C">C</a><br />\r\nAtins&nbsp;de&nbsp;iubirea&nbsp;Ta<br />\r\n'),
};
const songPage = (sheets) => `<html><body><h1>Cântare</h1>${sheets.map(([id, author]) => `<div class="listing"><a href="https://www.resursecrestine.ro/acorduri/${id}/fara-acorduri" class="listingTitleLink">Fără acorduri</a> <a href="https://www.resursecrestine.ro/acorduri/index-autori/x" class="brownLink">\n ${author} \n</a></div>`).join('')}</body></html>`;
const chordFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = new URL(url);
  if (!['www.resursecrestine.ro', 'resursecrestine.ro'].includes(u.hostname)) return chordFetch(url, opts);
  const res = (status, body, headers = {}) => new Response(body, { status, headers });
  if (u.pathname === '/cantece/opensong/503') return res(200, PLAIN_XML);
  const page = u.pathname.match(/^\/cantece\/(\d+)$/);
  if (page) return res(200, songPage(page[1] === '503' ? [[9001, 'Adeline M.'], [9002, 'Alin T.']] : []));
  const sheet = u.pathname.match(/^\/acorduri\/(\d+)\//);
  if (sheet) return SHEETS[sheet[1]] ? res(200, SHEETS[sheet[1]]) : res(404, '');
  if (u.pathname === '/web-api-search' && /ăr|ar/i.test(u.searchParams.get('search_text') || '')) {
    return res(200, JSON.stringify({ Results: [{ id: '503', title: 'Fără acorduri', title_slug: 'fara-acorduri', author: 'Autor Necunoscut', slug: 'cantece' }] }), { 'content-type': 'application/json' });
  }
  return chordFetch(url, opts);
};
