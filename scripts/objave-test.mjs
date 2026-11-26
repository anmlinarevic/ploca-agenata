// Objave i knjižnica: Claude (token „kreator”) predlaže preko MCP-a, vlasnik odobrava na ploči.
// Okolina: URL (dashboard), MCP (samostalni MCP), TOKEN_KREATOR, TOKEN_KONK.
const URL_ = process.env.URL || 'http://localhost:8798';
const MCP = process.env.MCP || 'http://localhost:8799';
const { TOKEN_KREATOR, TOKEN_KONK } = process.env;
const ok = (c, m) => { if (!c) { console.error('PAO:', m); process.exitCode = 1; } else console.log('ok  ', m); };

let rid = 0;
async function rpc(method, params, token = TOKEN_KREATOR) {
  const r = await fetch(MCP + '/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function alat(name, args = {}, token) {
  const { body } = await rpc('tools/call', { name, arguments: args }, token);
  if (body.error) return { greska: body.error.message };
  const t = body.result.content[0].text;
  return body.result.isError ? { greska: t } : JSON.parse(t);
}
async function zovi(metoda, put, { tijelo, zaglavlja = {}, sirovo } = {}) {
  const h = { 'x-dev-user': 'vlasnik@test.hr', ...zaglavlja };
  if (tijelo !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(URL_ + put, { method: metoda, headers: h, body: sirovo ?? (tijelo !== undefined ? JSON.stringify(tijelo) : undefined) });
  const buf = Buffer.from(await r.arrayBuffer());
  let d = null; try { d = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: r.status, d, buf, h: r.headers };
}
const ucitaj = (q, bajtovi, mime = 'image/jpeg', zaglavlja = { 'x-ploca-ucitavanje': '1' }) =>
  zovi('PUT', '/api/knjiznica/datoteka?' + new URLSearchParams(q), { sirovo: bajtovi, zaglavlja: { 'content-type': mime, ...zaglavlja } });

// alati prema tokenu
const alatiK = (await rpc('tools/list')).body.result.tools.map((t) => t.name);
ok(alatiK.includes('predlozi_objavu') && alatiK.includes('zatrazi_ucitavanje') && !alatiK.includes('dodaj_odluku') && !alatiK.includes('zadaj_zadatak'),
  'kreator vidi alate za objave, ne vidi odluke ni zadatke');
ok(!(await rpc('tools/list', {}, TOKEN_KONK)).body.result.tools.some((t) => t.name === 'predlozi_objavu'), 'agent konkurencije ne vidi alate za objave');
ok(!alatiK.some((t) => /odobri|objavi$/.test(t)), 'nema alata kojim Claude odobrava ili objavljuje');

// knjižnica: učitavanje s ploče
const FOTO = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9'.repeat(20), 'hex');
ok((await ucitaj({ slobodno: '1' }, FOTO, 'image/jpeg', {})).status === 415, 'učitavanje bez zaglavlja x-ploca-ucitavanje → 415');
ok((await ucitaj({ slobodno: '1' }, FOTO, 'image/jpeg', { 'x-ploca-ucitavanje': '1', origin: 'https://zlo.example' })).status === 403, 'učitavanje s drugog izvora → 403');
ok((await ucitaj({ slobodno: '1' }, Buffer.from('MZ'), 'application/x-msdownload')).status === 415, 'nedopuštena vrsta datoteke → 415');
const djeteBez = await ucitaj({ djeca: '1', pristanak: '0', slobodno: '1', opis: 'rođendan' }, FOTO);
ok(djeteBez.status === 400 && /pristanka/.test(djeteBez.d?.greska || ''), 'dijete bez pristanka ne može biti slobodno');
const A = await ucitaj({ usluga: 'banneri', opis: 'Kroj slova L', slobodno: '1', naziv: 'kroj.jpg' }, FOTO);
ok(A.status === 200 && A.d.kljuc.startsWith('piccolini/knjiznica/'), 'fotografija učitana u knjižnicu');
const B = await ucitaj({ usluga: 'igraonica', opis: 'Djeca u bazenu', djeca: '1', pristanak: '0', slobodno: '0' }, FOTO);
ok(B.status === 200, 'fotografija s djetetom učitana, ali ne za objave');

const knj = await alat('dohvati_knjiznicu');
ok(knj.stavke.some((k) => k.id === A.d.id) && !knj.stavke.some((k) => k.id === B.d.id) && knj.nije_slobodno >= 1, 'Claude vidi samo slobodan materijal');
ok(/slobodan/.test((await alat('zatrazi_preuzimanje', { knjiznica_id: B.d.id })).greska || ''), 'materijal koji nije slobodan ne može se preuzeti');
const pr = await alat('zatrazi_preuzimanje', { knjiznica_id: A.d.id });
const preuzeto = Buffer.from(await (await fetch(pr.url)).arrayBuffer());
ok(preuzeto.equals(FOTO), 'preuzimanje slobodnog materijala vraća istu datoteku');
ok((await fetch(MCP + '/preuzmi/' + 'x'.repeat(43))).status === 404, 'nepoznata adresa za preuzimanje → 404');

// učitavanje videa preko MCP-a
const VIDEO = Buffer.alloc(4096, 7);
const ul = await alat('zatrazi_ucitavanje', { mime: 'video/mp4' });
ok(ul.url && ul.kljuc.startsWith('piccolini/objave/') && ul.kljuc.endsWith('.mp4'), 'adresa za učitavanje videa');
ok((await fetch(ul.url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: VIDEO })).status === 415, 'pogrešna vrsta pri učitavanju → 415');
ok((await fetch(ul.url, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: VIDEO })).status === 201, 'video učitan');
ok((await fetch(ul.url, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: VIDEO })).status === 409, 'adresa za učitavanje je jednokratna');

// plan i objava
const plan = await alat('predlozi_plan_tjedna', { tjedan: '2026-W50', naslov: 'Tjedan imena', sazetak: 'Pon: Lucija\nSri: Iza šava' });
ok(plan.status === 'ceka', 'plan tjedna čeka odobrenje');
ok((await alat('predlozi_plan_tjedna', { tjedan: '2026-W50', naslov: 'Tjedan imena v2', sazetak: 'Ispravljeno' })).zamijenjen === true, 'neodobreni plan se zamjenjuje');
const osnova = { tjedan: '2026-W50', serija: 'imena', vrsta: 'video', naslov: 'Imena: Lucija', opis: 'Što znači ime Lucija? #imezabebu', termin: '2026-12-09T19:00:00+01:00', ai_oznaka: false };
ok(/nije označen/.test((await alat('predlozi_objavu', { ...osnova, mediji: [ul.kljuc], knjiznica: [B.d.id] })).greska || ''), 'objava ne smije koristiti materijal koji nije slobodan');
ok(/nije učitana/.test((await alat('predlozi_objavu', { ...osnova, mediji: ['piccolini/objave/2026-12/nema.mp4'] })).greska || ''), 'objava s neučitanom datotekom se odbija');
ok(/Neispravan ključ/.test((await alat('predlozi_objavu', { ...osnova, mediji: ['drugi/objave/x.mp4'] })).greska || ''), 'tuđi ključ se odbija');
ok(/Plan za/.test((await alat('predlozi_objavu', { ...osnova, tjedan: '2026-W51', mediji: [ul.kljuc] })).greska || ''), 'objava za tjedan bez plana se odbija');
const O = await alat('predlozi_objavu', { ...osnova, mediji: [ul.kljuc], knjiznica: [A.d.id] });
ok(O.status === 'ceka', 'objava čeka odobrenje');

// ploča
const st = (await zovi('GET', '/api/stanje')).d;
ok(st.objave.ceka >= 1 && st.objave.planoviCeka >= 1, '„Čeka tebe” zna za objave i plan');
const lista = (await zovi('GET', '/api/objave')).d;
const o1 = lista.objave.find((x) => x.id === O.id);
ok(o1 && o1.mediji[0].kljuc === ul.kljuc && o1.termin === '2026-12-09T18:00:00.000Z', 'objava na ploči s medijem i terminom');
const vid = await zovi('GET', '/api/mediji/' + ul.kljuc);
ok(vid.status === 200 && vid.buf.equals(VIDEO) && vid.h.get('content-type') === 'video/mp4', 'ploča poslužuje video');
const dio = await zovi('GET', '/api/mediji/' + ul.kljuc, { zaglavlja: { range: 'bytes=0-9' } });
ok(dio.status === 206 && dio.buf.length === 10 && dio.h.get('content-range') === 'bytes 0-9/4096',
  `premotavanje videa (Range → 206; dobiveno ${dio.status}, ${dio.buf.length} B, ${dio.h.get('content-range')})`);
const kraj = await zovi('GET', '/api/mediji/' + ul.kljuc, { zaglavlja: { range: 'bytes=-6' } });
ok(kraj.status === 206 && kraj.buf.length === 6 && kraj.h.get('content-range') === 'bytes 4090-4095/4096',
  `zadnjih 6 bajtova (Range sufiks; dobiveno ${kraj.status}, ${kraj.buf.length} B, ${kraj.h.get('content-range')})`);
ok((await zovi('GET', '/api/mediji/drugi/objave/x.mp4')).status === 404, 'tuđi ključ na ploči → 404');
ok((await zovi('GET', '/api/mediji/' + ul.kljuc, { zaglavlja: { 'x-dev-user': '' } })).status === 401, 'mediji traže prijavu');

// vrati → Claude ispravi → odobri → objavljeno
ok((await zovi('POST', `/api/objave/${O.id}/odluka`, { tijelo: { status: 'vraceno' } })).status === 400, 'vraćanje bez komentara se odbija');
ok((await zovi('POST', `/api/objave/${O.id}/odluka`, { sirovo: '{"status":"odobreno"}', zaglavlja: { 'content-type': 'text/plain' } })).status === 415, 'odluka bez JSON-a → 415');
ok((await zovi('POST', `/api/objave/${O.id}/odluka`, { tijelo: { status: 'vraceno', komentar: 'Kraći opis, bez hashtaga #imezabebu' } })).status === 200, 'vlasnik vraća s komentarom');
const vracene = await alat('dohvati_objave', { status: 'vraceno' });
ok(vracene.objave.some((x) => x.id === O.id && /Kraći opis/.test(x.komentar)), 'Claude vidi vraćenu objavu i komentar');
const isp = await alat('azuriraj_objavu', { id: O.id, opis: 'Što znači ime Lucija?' });
ok(isp.status === 'ceka' && isp.izmjena === 2, 'Claude ispravlja, objava ponovno čeka');
const o2 = (await zovi('GET', '/api/objave')).d.objave.find((x) => x.id === O.id);
ok(o2.komentar && o2.opis === 'Što znači ime Lucija?', 'komentar ostaje uz ispravljenu objavu');
ok((await zovi('POST', `/api/objave/${O.id}/odluka`, { tijelo: { status: 'odobreno', version: o1.version } })).status === 409, 'odobrenje stare inačice → 409');
ok((await zovi('POST', `/api/objave/${O.id}/odluka`, { tijelo: { status: 'odobreno', version: o2.version } })).status === 200, 'vlasnik odobrava');
ok(/ne može mijenjati/.test((await alat('azuriraj_objavu', { id: O.id, opis: 'potajno' })).greska || ''), 'Claude ne može mijenjati odobrenu objavu');
ok((await zovi('POST', `/api/objave/${O.id}/objavljeno`, { tijelo: { poveznica: 'http://tiktok.com/x' } })).status === 400, 'poveznica mora biti https');
ok((await zovi('POST', `/api/objave/${O.id}/objavljeno`, { tijelo: { poveznica: 'https://www.tiktok.com/@piccoliniplay/video/1' } })).status === 200, 'označeno kao objavljeno');
ok((await zovi('GET', '/api/objave')).d.objave.find((x) => x.id === O.id).status === 'objavljeno', 'status objavljeno');

// plan
const p = (await zovi('GET', '/api/objave')).d.planovi.find((x) => x.tjedan === '2026-W50');
ok((await zovi('POST', `/api/planovi-objava/${p.id}/odluka`, { tijelo: { status: 'odobreno' } })).status === 200, 'plan odobren');
ok(/već odobren/.test((await alat('predlozi_plan_tjedna', { tjedan: '2026-W50', naslov: 'x', sazetak: 'y' })).greska || ''), 'odobreni plan Claude ne može zamijeniti');

// oznake u knjižnici
ok((await zovi('POST', `/api/knjiznica/${B.d.id}`, { tijelo: { slobodno: true } })).status === 400, 'oznaka „smije u objave” za dijete bez pristanka se odbija');
ok((await zovi('POST', `/api/knjiznica/${B.d.id}`, { tijelo: { pristanak: true, slobodno: true } })).status === 200, 'uz pristanak smije u objave');
ok((await alat('dohvati_knjiznicu')).stavke.some((k) => k.id === B.d.id), 'Claude sada vidi i taj materijal');
ok((await zovi('POST', `/api/knjiznica/${A.d.id}/obrisi`, { tijelo: {} })).status === 200, 'brisanje iz knjižnice');
ok((await zovi('GET', '/api/mediji/' + A.d.kljuc)).status === 404, 'obrisana datoteka više ne postoji');

const stranica = await fetch(URL_ + '/objave.html');
ok(stranica.status === 200 && (await stranica.text()).includes('Plan tjedna'), 'stranica Objave se poslužuje');
ok((await fetch(URL_ + '/knjiznica.html')).status === 200, 'stranica Knjižnica se poslužuje');
