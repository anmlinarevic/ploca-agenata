// Lažni Google (OAuth za servisni račun + Search Console API) za lokalne testove.
// Prijava: POST /token s JWT-om potpisanim privatnim ključem; potpis se provjerava javnim ključem iz okoline GSC_JAVNI (PEM).
// Svojstvo: sc-domain:piccoliniplay.hr. Sitemap: /sitemap.xml na ovom serveru (4 adrese, jedna nije u indeksu).
// Upravljanje testom: POST /pokvari (ključ odbijen), /popravi, /bez-pristupa (403), /s-pristupom, GET /zahtjevi.
import http from 'node:http';
import { createPublicKey, verify } from 'node:crypto';

const port = Number(process.env.PORT || 8793);
const OSNOVA = `http://localhost:${port}`;
const SVOJSTVO = 'sc-domain:piccoliniplay.hr';
const POKAZNI = 'gsc-pristup';
const DAN = 86400000;
const javni = process.env.GSC_JAVNI ? createPublicKey(process.env.GSC_JAVNI) : null;
const zahtjevi = [];
let pokvareno = false, bezPristupa = false;

const posalji = (res, status, tijelo) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(tijelo)); };
const greska = (res, status, poruka) => posalji(res, status, { error: { code: status, message: poruka, status: status === 403 ? 'PERMISSION_DENIED' : 'ERROR' } });
const tijeloOd = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => r(s)); });
const b64uJson = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

const nedavno = (datum) => Date.parse(datum) >= Date.now() - 12 * DAN;
// [upit, klikovi, pojavljivanja, pozicija sada, pozicija prije]
const UPITI = [
  ['piccolini play', 40, 90, 1.0, 1.2],
  ['softplay najam', 30, 600, 4.2, 6.0],
  ['girlanda s imenom', 22, 400, 7.5, 7.1],
  ['banner za krštenje', 5, 180, 13.4, 17.0],
  ['igraonica zagreb', 2, 250, 3.1, 3.4],
  ['slova od tkanine marko 091 234 5678', 1, 12, 9.0, null],
];
const STRANICE = [['https://www.piccoliniplay.hr/', 60, 900, 3.5], ['https://www.piccoliniplay.hr/softplay', 35, 1500, 6.1],
  ['https://www.piccoliniplay.hr/banneri', 20, 1800, 11.2], ['https://www.piccoliniplay.hr/vodici/sigurna-igra-za-djecu-vodic', 5, 600, 18.4]];
const ZEMLJE = [['hrv', 104, 4100, 12.8], ['svn', 16, 700, 21.5]];
const red = (k, kl, po, poz) => ({ keys: [k], clicks: kl, impressions: po, ctr: po ? kl / po : 0, position: poz });

function analitika(b) {
  const ovo = nedavno(b.endDate), dims = b.dimensions || [];
  if (!dims.length) return { rows: [ovo ? { clicks: 120, impressions: 4800, ctr: 0.025, position: 14.2 } : { clicks: 90, impressions: 4100, ctr: 0.022, position: 16.8 }] };
  if (dims[0] === 'date') {
    const rows = [];
    for (let t = Date.parse(b.startDate), i = 0; t <= Date.parse(b.endDate); t += DAN, i++) {
      const kl = (i % 5) + 2, po = 140 + (i % 7) * 10;
      rows.push({ keys: [new Date(t).toISOString().slice(0, 10)], clicks: kl, impressions: po, ctr: kl / po, position: 14 });
    }
    return { rows };
  }
  if (dims[0] === 'query') return { rows: UPITI.filter((u) => ovo || u[4] != null).map((u) => red(u[0], ovo ? u[1] : Math.max(0, u[1] - 3), u[2], ovo ? u[3] : u[4])) };
  if (dims[0] === 'page') return { rows: STRANICE.map((s) => red(s[0], ovo ? s[1] : s[1] - 5, s[2], ovo ? s[3] : s[3] + 1)) };
  if (dims[0] === 'country') return { rows: ZEMLJE.map((z) => red(z[0], z[1], z[2], z[3])) };
  return { rows: [] };
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, OSNOVA);
  if (u.pathname === '/zahtjevi') return posalji(res, 200, { broj: zahtjevi.length, zadnji: zahtjevi.slice(-80) });
  if (req.method === 'POST' && u.pathname === '/pokvari') { pokvareno = true; return posalji(res, 200, {}); }
  if (req.method === 'POST' && u.pathname === '/popravi') { pokvareno = false; return posalji(res, 200, {}); }
  if (req.method === 'POST' && u.pathname === '/bez-pristupa') { bezPristupa = true; return posalji(res, 200, {}); }
  if (req.method === 'POST' && u.pathname === '/s-pristupom') { bezPristupa = false; return posalji(res, 200, {}); }
  const tijelo = await tijeloOd(req);
  zahtjevi.push(`${req.method} ${u.pathname}${u.search}`);

  if (u.pathname === '/sitemap.xml') {
    res.writeHead(200, { 'content-type': 'application/xml' });
    return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
      STRANICE.map((s) => `<url><loc>${s[0]}</loc></url>`).join('')}</urlset>`);
  }

  if (req.method === 'POST' && u.pathname === '/token') {
    const f = new URLSearchParams(tijelo);
    if (f.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return posalji(res, 400, { error: 'unsupported_grant_type' });
    const [g, t, p] = String(f.get('assertion') || '').split('.');
    let ok = false, claims = {};
    try {
      claims = b64uJson(t);
      ok = b64uJson(g).alg === 'RS256' && !!javni && verify('RSA-SHA256', Buffer.from(`${g}.${t}`), javni, Buffer.from(p, 'base64url'));
    } catch { ok = false; }
    if (!ok || pokvareno) return posalji(res, 400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
    const sad = Date.now() / 1000;
    if (claims.aud !== `${OSNOVA}/token` || claims.scope !== 'https://www.googleapis.com/auth/webmasters.readonly' || !claims.iss || claims.exp < sad || claims.exp - claims.iat > 3600)
      return posalji(res, 400, { error: 'invalid_grant', error_description: 'Invalid JWT claims.' });
    return posalji(res, 200, { access_token: POKAZNI, expires_in: 3599, token_type: 'Bearer' });
  }

  if ((req.headers.authorization || '') !== `Bearer ${POKAZNI}`) return greska(res, 401, 'Request had invalid authentication credentials.');
  const site = `/webmasters/v3/sites/${encodeURIComponent(SVOJSTVO)}`;
  const m = /^\/webmasters\/v3\/sites\/([^/]+)(\/.*)?$/.exec(u.pathname);
  if (m && (decodeURIComponent(m[1]) !== SVOJSTVO || bezPristupa)) return greska(res, 403, `User does not have sufficient permission for site '${decodeURIComponent(m[1])}'.`);

  if (req.method === 'GET' && u.pathname === site) return posalji(res, 200, { siteUrl: SVOJSTVO, permissionLevel: 'siteRestrictedUser' });
  if (req.method === 'POST' && u.pathname === `${site}/searchAnalytics/query`) return posalji(res, 200, analitika(JSON.parse(tijelo || '{}')));
  if (req.method === 'GET' && u.pathname === `${site}/sitemaps`) {
    return posalji(res, 200, { sitemap: [{ path: `${OSNOVA}/sitemap.xml`, lastSubmitted: '2026-11-20T09:00:00.000Z', lastDownloaded: '2026-11-24T03:12:00.000Z',
      isPending: false, isSitemapsIndex: false, warnings: '0', errors: '0', contents: [{ type: 'web', submitted: String(STRANICE.length), indexed: '0' }] }] });
  }
  if (req.method === 'POST' && u.pathname === '/v1/urlInspection/index:inspect') {
    const b = JSON.parse(tijelo || '{}');
    if (b.siteUrl !== SVOJSTVO) return greska(res, 403, 'You do not own this site, or the inspected URL is not part of this property.');
    const nije = /sigurna-igra/.test(b.inspectionUrl);
    return posalji(res, 200, { inspectionResult: { inspectionResultLink: 'https://search.google.com/search-console/inspect', indexStatusResult: {
      verdict: nije ? 'NEUTRAL' : 'PASS', coverageState: nije ? 'Crawled - currently not indexed' : 'Submitted and indexed',
      robotsTxtState: 'ALLOWED', indexingState: 'INDEXING_ALLOWED', lastCrawlTime: '2026-11-22T10:00:00Z', pageFetchState: 'SUCCESSFUL',
      googleCanonical: b.inspectionUrl, userCanonical: b.inspectionUrl } } });
  }
  return greska(res, 404, 'Requested entity was not found.');
}).listen(port, () => console.log(`lažni Google na ${OSNOVA}`));
