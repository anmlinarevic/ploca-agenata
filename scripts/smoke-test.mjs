// Dimni test protiv pokrenutog servera. Obično ga pokreće scripts/test-lokalno.mjs (svježa baza).
// Okolina: TOKEN (koordinator), TOKEN_KONK (konkurencija), neobavezno URL.
const URL_ = process.env.URL || 'http://localhost:8787';
const { TOKEN, TOKEN_KONK } = process.env;
if (!TOKEN || !TOKEN_KONK) { console.error('Postavi TOKEN i TOKEN_KONK'); process.exit(1); }

let id = 0;
async function rpc(method, params, token = TOKEN) {
  const r = await fetch(`${URL_}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
}
const ok = (c, m) => { if (!c) { console.error('PAO:', m); process.exitCode = 1; } else console.log('ok  ', m); };
// vraća {podaci} ili {greska}
async function poziv(name, args = {}, token = TOKEN) {
  const { body } = await rpc('tools/call', { name, arguments: args }, token);
  if (body.error) return { greska: body.error.message };
  const t = body.result.content[0].text;
  return body.result.isError ? { greska: t } : { podaci: JSON.parse(t) };
}

// --- čitanje ---
ok((await rpc('tools/list', {}, 'pogresan')).status === 401, 'pogrešan token → 401');
ok((await rpc('tools/list')).body.result.tools.length >= 16, 'koordinator vidi sve alate');
const alatiKonk = (await rpc('tools/list', {}, TOKEN_KONK)).body.result.tools.map((t) => t.name);
ok(alatiKonk.includes('azuriraj_konkurenta') && !alatiKonk.includes('upisi_mjesecno'), 'konkurencija vidi samo svoje alate');
const otvorene = (await poziv('dohvati_otvorene_odluke')).podaci;
ok(otvorene.length === 6 && otvorene.every((o) => o.status === 'ceka'), 'otvorene odluke: 6');
const konk = (await poziv('dohvati_konkurente')).podaci;
ok(konk.length === 12 && konk.find((k) => k.id === 'imemojemalo').usporedba.c3.n === 35, 'konkurenti i JSON polja');
ok((await poziv('dohvati_napredak')).podaci[0].stavke.length === 10, 'napredak');
ok((await poziv('obrisi_sve')).greska?.includes('Nepoznat'), 'nepoznat alat se odbija');

// --- odluke ---
ok((await poziv('dodaj_odluku', { naslov: 'T', razlog: 'r', prijedlog: 'p' })).greska?.includes('najviše 3'), 'koordinator je već na ograničenju (4 odluke od 20. 11.)');
const o = (await poziv('dodaj_odluku', { naslov: 'Test', razlog: 'r', prijedlog: 'p' }, TOKEN_KONK)).podaci;
ok(o?.status === 'ceka', 'dodaj_odluku → ceka');
ok((await poziv('azuriraj_odluku_izvrsenje', { id: o.id, status: 'gotovo', rezultat: 'x' })).greska?.includes('nije odobrena'),
  'neodobrena odluka se ne može izvršiti');
ok((await poziv('azuriraj_odluku_izvrsenje', { id: 'o6', status: 'u_izradi' })).greska?.includes('nije odobrena'),
  'odbijena/čekajuća odluka se ne može izvršiti');
await poziv('dodaj_odluku', { naslov: 'Test 2', razlog: 'r', prijedlog: 'p' }, TOKEN_KONK);
await poziv('dodaj_odluku', { naslov: 'Test 3', razlog: 'r', prijedlog: 'p' }, TOKEN_KONK);
ok((await poziv('dodaj_odluku', { naslov: 'Test 4', razlog: 'r', prijedlog: 'p' }, TOKEN_KONK)).greska?.includes('najviše 3'),
  'četvrta odluka u tjednu se odbija');
const tekst = 'x'.repeat(201);
ok((await poziv('dodaj_odluku', { naslov: tekst, razlog: 'r', prijedlog: 'p' }, TOKEN_KONK)).greska?.includes('predug'),
  'predug naslov se odbija');
// odobrena odluka iz izvoza (o1 je gotovo → nije dopuštena); nađi odobrenu ako postoji
const odobrene = (await poziv('dohvati_odobrene_odluke')).podaci;
if (odobrene.length) {
  const r = await poziv('azuriraj_odluku_izvrsenje', { id: odobrene[0].id, status: 'gotovo', rezultat: 'Testirano' });
  ok(r.podaci?.status === 'gotovo', 'odobrena odluka se izvršava');
}

// --- koordinator raspoređuje posao (samo odbijanja: valjan zadatak bi se kasnije sam pokrenuo i pomaknuo brojke testova) ---
ok((await poziv('zadaj_zadatak', { agent: 'sadrzaj', opis: 'Napiši nacrt teksta za FAQ o vješanju.' }, TOKEN_KONK)).greska?.includes('ne dopušta'), 'zadaj_zadatak nije dopušten agentu');
ok((await poziv('zadaj_zadatak', { agent: 'sadrzaj', opis: 'kratko' })).greska?.includes('prekratak'), 'prekratak opis zadatka se odbija');
ok((await poziv('zadaj_zadatak', { agent: 'koordinator', opis: 'Napiši nacrt teksta za FAQ o vješanju.' })).greska, 'koordinator ne zadaje sam sebi');
ok((await poziv('zadaj_zadatak', { agent: 'sadrzaj', opis: 'Napiši nacrt teksta za FAQ o vješanju.', odluka_id: otvorene[0].id })).greska?.includes('nije odobrena'), 'zadatak uz neodobrenu odluku se odbija');
const pr1 = (await poziv('zatrazi_pristup', { sto: 'Test pristup (smoke)', zasto: 'test', kako: 'koraci' })).podaci;
ok(pr1?.id && pr1.status === 'otvoreno', 'zatrazi_pristup zapisuje zahtjev');
ok((await poziv('zatrazi_pristup', { sto: 'test PRISTUP (smoke)', zasto: 'opet' })).podaci?.vec_postoji === true, 'isti otvoreni zahtjev se ne ponavlja');
ok((await poziv('dohvati_pristupe')).podaci.some((p) => p.id === pr1.id), 'dohvati_pristupe');
ok(Array.isArray((await poziv('dohvati_zadatke', { otvoreni: true })).podaci), 'dohvati_zadatke');
ok((await poziv('azuriraj_odluku_izvrsenje', { id: 'o6', status: 'u_izradi', ceka_tebe: 'x' })).greska?.includes('nije odobrena'), 'ceka_tebe samo na odobrenoj odluci');

// --- ostalo ---
ok((await poziv('upisi_mjesecno', { mjesec: '2026-12', aiSpominjanja: 3, aiPitanja: 12 })).podaci?.ai_spominjanja === 3, 'upisi_mjesecno');
ok((await poziv('upisi_mjesecno', { mjesec: '2026-12', gscKlikovi: 40 })).podaci?.ai_spominjanja === 3, 'upisi_mjesecno čuva ostala polja');
ok((await poziv('upisi_mjesecno', { mjesec: '12/2026' })).greska, 'neispravan mjesec se odbija');
ok((await poziv('oznaci_napredak', { faza: 'faza0', red: 4, gotovo: true })).podaci?.gotovo === true, 'oznaci_napredak');
ok((await poziv('oznaci_napredak', { faza: 'faza0', red: 99, gotovo: true })).greska, 'nepostojeća stavka se odbija');
ok((await poziv('dodaj_aktivnost', { sto: 'Test', agent: 'seo' })).podaci?.id, 'koordinator piše aktivnost u ime agenta');

// --- registri ---
const popis = (await poziv('dohvati_registar')).podaci;
ok(popis.length >= 5 && popis.some((r) => r.kljuc === 'kljucne-rijeci' && r.verzija === 1), `popis registara (${popis.length})`);
const kr = (await poziv('dohvati_registar', { kljuc: 'kljucne-rijeci' })).podaci;
ok(kr.tijelo.length > 500, 'registar se čita s cijelim tekstom');
ok((await poziv('dohvati_registar', { kljuc: 'ne-postoji' })).greska?.includes('ne postoji'), 'nepostojeći registar');
ok((await poziv('spremi_registar', { kljuc: 'kljucne-rijeci', tijelo: kr.tijelo + '\n- test', if_verzija: 99 })).greska?.includes('promijenjen'), 'pogrešna verzija se odbija');
ok((await poziv('spremi_registar', { kljuc: 'kljucne-rijeci', tijelo: 'kratko', if_verzija: kr.verzija })).greska?.includes('polovice'), 'skraćivanje za više od pola se odbija');
ok((await poziv('spremi_registar', { kljuc: 'nepoznat-registar', tijelo: 'x', if_verzija: 1 })).greska?.includes('Nepoznat'), 'nepoznat ključ se odbija');
const nov = (await poziv('spremi_registar', { kljuc: 'kljucne-rijeci', tijelo: kr.tijelo + '\n- test koordinator', if_verzija: kr.verzija })).podaci;
ok(nov?.verzija === kr.verzija + 1, 'ispravan zapis podiže verziju');
ok((await poziv('spremi_registar', { kljuc: 'kljucne-rijeci', tijelo: 'x', if_verzija: 1 }, TOKEN_KONK)).greska?.includes('ne dopušta'), 'konkurencija nema alat za registre');
if (process.env.TOKEN_SEO) {
  const sk = (await poziv('dohvati_registar', { kljuc: 'partneri' }, process.env.TOKEN_SEO)).podaci;
  ok((await poziv('spremi_registar', { kljuc: 'partneri', tijelo: sk.tijelo + '\n- x', if_verzija: sk.verzija }, process.env.TOKEN_SEO)).greska?.includes('ne smije'), 'SEO ne smije mijenjati registar partnera');
}
// Povratak na originalni tekst da kasniji testovi (SEO agent u izvršitelju) počnu od poznatog stanja neovisno o ovome:
// verzija se ne vraća unatrag, pa izvršitelj-test računa verziju iz registra, ne iz konstante.

// --- konkurent ---
ok((await poziv('azuriraj_konkurenta', { id: 'imemojemalo', polja: { napomena: 'test' } }, TOKEN_KONK)).podaci,
  'konkurencija mijenja konkurenta');
ok((await poziv('azuriraj_konkurenta', { id: 'imemojemalo', polja: { id: 'x' } }, TOKEN_KONK)).greska?.includes('nije dopušteno'),
  'polje izvan popisa se odbija');
ok((await poziv('azuriraj_konkurenta', { id: 'piccolini', polja: { napomena: 'x' } }, TOKEN_KONK)).greska?.includes('odobrenu odluku'),
  'naš red traži odobrenu odluku');
ok((await poziv('azuriraj_konkurenta', { id: 'novi-igrac', polja: { naziv: 'Novi', trziste: 'HR' } }, TOKEN_KONK)).podaci,
  'novi konkurent');
ok((await poziv('upisi_mjesecno', { mjesec: '2026-12' }, TOKEN_KONK)).greska?.includes('ne dopušta'), 'konkurencija ne smije upisati mjesečno');
ok((await poziv('dodaj_aktivnost', { sto: 'x', agent: 'seo' }, TOKEN_KONK)).podaci, 'konkurencija piše aktivnost');
