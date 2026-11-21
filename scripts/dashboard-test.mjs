// API dashboarda protiv pokrenutog servera (DEV_USER='*', e-mail iz zaglavlja x-dev-user).
// Okolina: URL (zadano http://localhost:8798).
const URL_ = process.env.URL || 'http://localhost:8798';
const ok = (c, m) => { if (!c) { console.error('PAO:', m); process.exitCode = 1; } else console.log('ok  ', m); };

async function zovi(metoda, put, { korisnik = 'vlasnik@test.hr', tijelo, tenant, zaglavlja = {} } = {}) {
  const h = { ...zaglavlja };
  if (korisnik) h['x-dev-user'] = korisnik;
  if (tenant) h['x-tenant'] = tenant;
  if (tijelo !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(URL_ + put, { method: metoda, headers: h, body: tijelo !== undefined ? JSON.stringify(tijelo) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, d, t };
}

// prijava
ok((await zovi('GET', '/api/stanje', { korisnik: null })).status === 401, 'bez prijave → 401');
ok((await zovi('GET', '/api/stanje', { korisnik: 'nepoznat@test.hr' })).status === 403, 'nepoznat e-mail → 403');
const idx = await fetch(URL_ + '/');
ok(idx.status === 200 && (await idx.text()).includes('Upravljačka ploča'), 'statična stranica se poslužuje');

// vlasnik
const ja = await zovi('GET', '/api/ja');
ok(ja.d.uloga === 'vlasnik' && ja.d.tenanti.length === 1, 'vlasnik vidi samo svog zakupca');
const st = (await zovi('GET', '/api/stanje')).d;
ok(st.odluke.filter((o) => o.status === 'ceka').length >= 6 && st.konkurenti.length >= 12, 'stanje: odluke koje čekaju i 12+ konkurenata (MCP test je dodao nove)');
ok(st.konkurenti.find((k) => k.id === 'imemojemalo').usporedba.c3.n === 35, 'camelCase oblik isti kao u staroj ploči');
ok(!st.odluke.some((o) => o.naslov === 'Tuđa odluka'), 'vlasnik ne vidi podatke drugog zakupca');
const x = await zovi('GET', '/api/stanje', { tenant: 'drugi' });
ok(!x.d.odluke.some((o) => o.naslov === 'Tuđa odluka'), 'vlasnik ne može zaglavljem X-Tenant promijeniti zakupca');

// odluke
const cekaju = st.odluke.filter((o) => o.status === 'ceka');
const id = cekaju[0].id;
ok((await zovi('POST', `/api/odluke/${id}/odluka`, { tijelo: { status: 'odobreno', komentar: 'Može.' } })).status === 200, 'odobri odluku');
ok((await zovi('POST', `/api/odluke/${id}/odluka`, { tijelo: { status: 'odbijeno' } })).status === 409, 'dvaput se ne može odlučiti');
ok((await zovi('POST', `/api/odluke/${cekaju[1].id}/odluka`, { tijelo: { status: 'gotovo' } })).status === 400, 'status "gotovo" ne može postaviti čovjek ovdje');
const nakon = (await zovi('GET', '/api/stanje')).d;
const o = nakon.odluke.find((q) => q.id === id);
ok(o.status === 'odobreno' && o.komentar === 'Može.' && o.odlucenoAt, 'odluka spremljena s komentarom i vremenom');
ok(nakon.aktivnost[0].agent === 'ti' && nakon.aktivnost[0].sto.startsWith('Odobreno'), 'dnevnik bilježi odobrenje');

// zadaci
const z = await zovi('POST', '/api/zadaci', { tijelo: { agent: 'seo', opis: 'Provjeri naslove stranica', rok: '2026-12-01' } });
ok(z.status === 200 && z.d.id, 'novi zadatak');
ok((await zovi('POST', '/api/zadaci', { tijelo: { agent: 'hakeri', opis: 'Nešto nešto' } })).status === 400, 'nepoznat agent se odbija');
ok((await zovi('POST', '/api/zadaci', { tijelo: { agent: 'seo', opis: 'a' } })).status === 400, 'prekratak opis se odbija');
ok((await zovi('POST', `/api/zadaci/${z.d.id}/status`, { tijelo: { status: 'gotovo' } })).status === 200, 'zatvori zadatak');
ok((await zovi('POST', `/api/zadaci/${z.d.id}/status`, { tijelo: { status: 'odbijeno' } })).status === 409, 'zatvoren zadatak se ne mijenja');

// tjedni
const t = await zovi('PUT', '/api/tjedni/2026-W47', { tijelo: { od: '2026-11-16', upitiBanner: 4, upitiIgraonica: 1, narudzbe: 2, rezervacije: 0, izvori: { instagram: 2, ai: 1 } } });
ok(t.status === 200, 'upis tjedna');
const tj = (await zovi('GET', '/api/stanje')).d.tjedni.find((q) => q.id === '2026-W47');
ok(tj.upitiBanner === 4 && tj.izvori.ai === 1 && tj.izvori.google === 0, 'tjedan čitljiv, izvori dopunjeni nulama');
ok((await zovi('PUT', '/api/tjedni/2026-W47', { tijelo: { upitiBanner: -3, izvori: {} } })).status === 400, 'negativan broj se odbija');
ok((await zovi('PUT', '/api/tjedni/neispravno', { tijelo: {} })).status === 404, 'neispravan ključ tjedna → 404');

// napredak
ok((await zovi('POST', '/api/napredak/faza0/5', { tijelo: { gotovo: true } })).status === 200, 'kvačica na stavci');
ok((await zovi('POST', '/api/napredak/faza0/99', { tijelo: { gotovo: true } })).status === 404, 'nepostojeća stavka → 404');

// CSRF
ok((await zovi('POST', '/api/zadaci', { tijelo: { agent: 'seo', opis: 'Tuđi izvor zahtjeva' }, zaglavlja: { origin: 'https://zlo.example' } })).status === 403, 'zahtjev s tuđeg izvora → 403');
const bezJson = await fetch(URL_ + '/api/zadaci', { method: 'POST', headers: { 'x-dev-user': 'vlasnik@test.hr', 'content-type': 'text/plain' }, body: '{}' });
ok(bezJson.status === 415, 'pisanje bez JSON-a → 415');

// savjetnik
const sj = await zovi('GET', '/api/ja', { korisnik: 'savjetnik@test.hr' });
ok(sj.d.uloga === 'savjetnik' && sj.d.tenanti.length === 2, 'savjetnik vidi oba zakupca');
const sd = (await zovi('GET', '/api/stanje', { korisnik: 'savjetnik@test.hr', tenant: 'drugi' })).d;
ok(sd.odluke.length === 1 && sd.odluke[0].naslov === 'Tuđa odluka', 'savjetnik bira zakupca');
ok((await zovi('GET', '/api/stanje', { korisnik: 'savjetnik@test.hr', tenant: 'ne-postoji' })).status === 404, 'nepoznat zakupac → 404');
ok((await zovi('POST', `/api/odluke/${cekaju[2].id}/odluka`, { korisnik: 'savjetnik@test.hr', tenant: 'drugi', tijelo: { status: 'odobreno' } })).status === 404,
  'odluka iz drugog zakupca ne može se riješiti kroz tuđi zakupac');
