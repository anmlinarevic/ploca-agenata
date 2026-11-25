// Lažni Meta Graph API (v25.0) za lokalne testove i demo: Facebook stranica 555 s povezanim Instagramom 777.
// Token: Bearer test-meta. Upravljanje testom: POST /pokvari (token istekao), POST /popravi, POST /nova-objava, GET /zahtjevi.
import http from 'node:http';

const port = Number(process.env.PORT || 8792);
const DAN = 86400000;
const zahtjevi = [];
let pokvareno = false;

// Vrijeme objave: prije `dana` dana u `sat` sati po Zagrebu (zimsko vrijeme, UTC+1); oblik kao Meta: +0000
const kad = (dana, sat) => {
  const d = new Date(Date.now() - dana * DAN);
  d.setUTCHours(sat - 1, 0, 0, 0);
  return d.toISOString().replace('.000Z', '+0000');
};
// [dana, sat, vrsta, pregledi, spremanja, opis]
const IG = [
  [58, 9, 'IMAGE', 310, 1, 'Igraonica spremna za vikend'],
  [52, 20, 'REELS', 1420, 6, 'Ime LUCIJA slovo po slovo'],
  [45, 11, 'CAROUSEL_ALBUM', 480, 3, 'Tri tkanine, jedno ime'],
  [38, 20, 'REELS', 1650, 9, 'Banner za krštenje, ruža i menta'],
  [31, 14, 'IMAGE', 390, 2, 'Pas skakalica u dnevnom boravku'],
  [24, 20, 'REELS', 1880, 11, 'Kako naručiti u 3 koraka, piši @ana.kupac ili 091 234 5678'],
  [17, 8, 'IMAGE', 350, 1, 'Novi uzorci tkanina'],
  [12, 20, 'REELS', 2310, 14, 'Odbrojavanje do rođendana'],
  [7, 17, 'CAROUSEL_ALBUM', 620, 4, 'Rođendanski set iz radionice'],
  [3, 20, 'REELS', 2650, 17, 'Sretan rođendan u tri boje'],
  [1, 11, 'IMAGE', 280, 0, 'Subota u igraonici'],
];
const igObjave = IG.map(([dana, sat, tip, pregledi, spremanja, opis], i) => ({
  id: `1790${String(i).padStart(4, '0')}`, caption: opis, media_type: tip === 'REELS' ? 'VIDEO' : tip, media_product_type: tip === 'REELS' ? 'REELS' : 'FEED',
  timestamp: kad(dana, sat), permalink: `https://www.instagram.com/p/primjer${i}/`, like_count: Math.round(pregledi / 22), comments_count: Math.round(pregledi / 300),
  _uvidi: { views: pregledi, reach: Math.round(pregledi * 0.8), saved: spremanja, shares: Math.round(spremanja / 2), total_interactions: Math.round(pregledi / 18) },
  _stara: i === 0, // najstarija objava ne daje 'views' (kao objave prije promjene metrika)
}));
const fbObjave = [[40, 19, 'added_photos', 420], [26, 20, 'added_video', 690], [9, 20, 'added_video', 730], [2, 12, 'mobile_status_update', 210]]
  .map(([dana, sat, st, pregledi], i) => ({ id: `555_${900 + i}`, message: `Objava ${i + 1} sa stranice`, created_time: kad(dana, sat), status_type: st,
    permalink_url: `https://www.facebook.com/555/posts/${900 + i}`, _uvidi: { post_media_view: pregledi, post_total_media_view_unique: Math.round(pregledi * 0.7),
      post_reactions_by_type_total: { like: Math.round(pregledi / 40), love: 2 }, post_clicks: Math.round(pregledi / 30) } }));

const posalji = (res, status, tijelo) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(tijelo)); };
const meka = (res, poruka) => posalji(res, 400, { error: { message: poruka, type: 'OAuthException', code: 100 } });
const vrijednosti = (ime, v) => ({ name: ime, period: 'lifetime', values: [{ value: v }], id: `x/insights/${ime}/lifetime` });

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/zahtjevi') return posalji(res, 200, { broj: zahtjevi.length, zadnji: zahtjevi.slice(-60) });
  if (req.method === 'POST' && u.pathname === '/pokvari') { pokvareno = true; return posalji(res, 200, {}); }
  if (req.method === 'POST' && u.pathname === '/popravi') { pokvareno = false; return posalji(res, 200, {}); }
  if (req.method === 'POST' && u.pathname === '/nova-objava') {
    igObjave.push({ ...igObjave[igObjave.length - 2], id: `1799${igObjave.length}`, timestamp: kad(0, 9), caption: 'Nova objava' });
    return posalji(res, 200, {});
  }
  zahtjevi.push(req.method + ' ' + u.pathname + u.search);
  if (pokvareno || req.headers.authorization !== 'Bearer test-meta')
    return posalji(res, 400, { error: { message: 'Error validating access token: Session has expired.', type: 'OAuthException', code: 190, error_subcode: 463 } });
  if (req.method !== 'GET') return posalji(res, 405, {});
  const put = u.pathname.replace(/^\/v25\.0\//, ''), metrike = (u.searchParams.get('metric') || '').split(',').filter(Boolean);

  if (put === '555') return posalji(res, 200, { name: 'Piccolini Play', followers_count: 842, instagram_business_account: { id: '777', username: 'piccoliniplay', followers_count: 1284 }, id: '555' });
  if (put === '777/insights') {
    const prethodno = +u.searchParams.get('since') < Date.now() / 1000 - 40 * 86400;
    const v = prethodno ? { reach: 11200, views: 19800, total_interactions: 640, saves: 41, shares: 22 } : { reach: 14200, views: 26400, total_interactions: 910, saves: 68, shares: 35 };
    return posalji(res, 200, { data: metrike.map((m) => ({ name: m, period: 'day', title: m, total_value: { value: v[m] ?? 0 }, id: `777/insights/${m}/day` })) });
  }
  if (put === '777/media') return posalji(res, 200, { data: [...igObjave].reverse().map(({ _uvidi, _stara, ...m }) => m), paging: {} });
  if (put === '555/insights') {
    const n = (a) => [{ value: a[0], end_time: new Date(Date.now() - 29 * DAN).toISOString() }, { value: a[1], end_time: new Date().toISOString() }];
    return posalji(res, 200, { data: [{ name: 'page_media_view', period: 'days_28', values: n([4100, 6900]) }, { name: 'page_total_media_view_unique', period: 'days_28', values: n([2600, 4300]) }] });
  }
  if (put === '555/posts') return posalji(res, 200, { data: [...fbObjave].reverse().map(({ _uvidi, ...p }) => p) });
  let m;
  if ((m = /^([\w]+)\/insights$/.exec(put))) {
    const o = igObjave.find((x) => x.id === m[1]) || fbObjave.find((x) => x.id === m[1]);
    if (!o) return meka(res, 'Unsupported get request.');
    if (o._stara && metrike.includes('views')) return meka(res, '(#100) The Media Insights API does not support the views metric for this media product type.');
    return posalji(res, 200, { data: metrike.filter((x) => x in o._uvidi).map((x) => vrijednosti(x, o._uvidi[x])) });
  }
  return meka(res, `Unsupported get request. Object with ID '${put}' does not exist`);
}).listen(port, () => console.log(`Lažna Meta na http://localhost:${port}`));
