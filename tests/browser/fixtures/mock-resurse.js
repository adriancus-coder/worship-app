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
