// Test izvršitelja kroz dashboard (DEV_USER='*'). Argument: faza1 (normalan rad) ili faza2 (limit potrošnje).
const URL_ = process.env.URL || 'http://localhost:8798';
const FAKE = process.env.FAKE || 'http://localhost:8790';
const faza = process.argv[2] || 'faza1';
const ok = (c, m) => { if (!c) { console.error('PAO:', m); process.exitCode = 1; } else console.log('ok  ', m); };

async function zovi(metoda, put, tijelo) {
  const h = { 'x-dev-user': 'vlasnik@test.hr' };
  if (tijelo !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(URL_ + put, { method: metoda, headers: h, body: tijelo !== undefined ? JSON.stringify(tijelo) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, d };
}
const stanje = async () => (await zovi('GET', '/api/stanje')).d;
async function cekaj(uvjet, ms = 90000) {
  const kraj = Date.now() + ms;
  while (Date.now() < kraj) { const s = await stanje(); const r = uvjet(s); if (r) return r; await new Promise((x) => setTimeout(x, 1500)); }
  return null;
}
const zavrseno = (p) => ['uspjeh', 'greska', 'odbijeno_limit', 'prekinuto_limit', 'prekinuto_vrijeme'].includes(p.status);

if (faza === 'faza1') {
  // 1. zadatak za agenta konkurencija
  const z = (await zovi('POST', '/api/zadaci', { agent: 'konkurencija', opis: 'Tjedni pregled konkurencije (test)' })).d;
  const pk = await zovi('POST', `/api/zadaci/${z.id}/pokreni`, {});
  ok(pk.status === 200 && pk.d.pokretanje_id, 'zadatak se stavlja u red');
  ok((await zovi('POST', `/api/zadaci/${z.id}/pokreni`, {})).status === 409, 'isti zadatak se ne može pokrenuti dvaput');
  const p1 = await cekaj((s) => s.pokretanja.find((p) => p.id === pk.d.pokretanje_id && zavrseno(p)));
  ok(p1?.status === 'uspjeh', `pokretanje završava uspjehom (${p1?.status}${p1?.greska ? ': ' + p1.greska : ''})`);
  ok(p1?.pretrage === 2 && p1?.trosak > 0, `trošak i pretrage zabilježeni (${p1?.trosak} USD, ${p1?.pretrage} pretraga)`);
  // procjena: ulaz 27000*2 + izlaz 1600*10 + cache 44000*0.1 = 0.054+0.016+0.0044 = 0.0744 + 2*0.01 = 0.0944
  ok(Math.abs(p1.trosak - 0.0944) < 0.001, `trošak odgovara izračunu (0,0944 USD, dobiveno ${p1.trosak})`);
  let s = await stanje();
  const zad = s.zadaci.find((q) => q.id === z.id);
  ok(zad.status === 'gotovo' && zad.rezultat.includes('Sažetak'), 'zadatak je gotov s rezultatom agenta');
  ok(s.izvjestaji.some((x) => x.naslov === 'Konkurencija (test)' && x.agent === 'konkurencija'), 'izvještaj je spremljen kroz MCP');
  ok(s.konkurenti.find((k) => k.id === 'imemojemalo').napomena === 'Lažna provjera', 'registar konkurenata ažuriran kroz MCP');
  ok(s.potrosnja.potroseno > 0 && s.potrosnja.limit === 20, 'potrošnja i limit u sažetku');

  // 2. što je stvarno poslano Claude API-ju
  const zahtjevi = await (await fetch(FAKE + '/zahtjevi')).json();
  const prvi = zahtjevi[0];
  ok(prvi.model === 'claude-sonnet-5-5' && prvi.effort === 'medium' && prvi.cache, 'model, effort i cache_control su postavljeni');
  ok(prvi.alati.includes('web_search') && prvi.alati.includes('web_fetch') && prvi.alati.includes('azuriraj_konkurenta'), 'konkurencija dobiva web alate i svoje alate ploče');
  ok(!prvi.alati.includes('upisi_mjesecno') && !prvi.alati.includes('azuriraj_odluku_izvrsenje'), 'ne dobiva tuđe alate (token ih ne dopušta)');
  const povrat = zahtjevi[2].zadnjaPoruka;
  ok(povrat.role === 'user' && povrat.content.length === 3 && povrat.content.every((c) => c.type === 'tool_result'), 'svi rezultati alata vraćeni u jednoj poruci');
  ok(povrat.content[2].is_error === true, 'nepostojeći alat vraća is_error, ne ruši pokretanje');

  // 3. tjedni pregled: lanac konkurencija -> koordinator
  const prije = s.pokretanja.length;
  const pr = await zovi('POST', '/api/pregled', {});
  ok(pr.status === 200, 'tjedni pregled se stavlja u red');
  const lanac = await cekaj((q) => { const novi = q.pokretanja.filter((p) => p.vrsta === 'pregled'); return novi.length >= 2 && novi.every(zavrseno) ? novi : null; });
  ok(lanac && lanac.length === 2 && lanac.every((p) => p.status === 'uspjeh'), 'lanac: oba agenta uspješna');
  ok(lanac && lanac.some((p) => p.agent === 'koordinator'), 'koordinator se pokreće nakon konkurencije');
  s = await stanje();
  ok(s.izvjestaji.some((x) => x.naslov === 'Tjedni pregled (test)' && x.agent === 'koordinator'), 'sažetak koordinatora spremljen');
  const iz = (await zovi('GET', '/api/izvjestaj/' + s.izvjestaji.find((x) => x.agent === 'koordinator').id)).d;
  ok(iz.tijelo.includes('Za odluku'), 'cijeli tekst izvještaja se dohvaća');

  // 4. agent kojeg izvršitelj još nema
  const z2 = (await zovi('POST', '/api/zadaci', { agent: 'seo', opis: 'SEO provjera naslova (test)' })).d;
  const r2 = await zovi('POST', `/api/zadaci/${z2.id}/pokreni`, {});
  ok(r2.status === 422 && r2.d.greska.includes('još nije dostupan'), 'agent bez definicije: jasna poruka, zadatak ostaje novi');
  ok((await stanje()).zadaci.find((q) => q.id === z2.id).status === 'novo', 'zadatak ostaje "novo"');
}

if (faza === 'faza2') {
  // Limit je prije ove faze postavljen na 0,01 USD, a potrošeno je više
  const z = (await zovi('POST', '/api/zadaci', { agent: 'koordinator', opis: 'Zadatak nakon limita (test)' })).d;
  const pk = await zovi('POST', `/api/zadaci/${z.id}/pokreni`, {});
  const p = await cekaj((s) => s.pokretanja.find((q) => q.id === pk.d.pokretanje_id && zavrseno(q)));
  ok(p?.status === 'odbijeno_limit', `iznad limita se agent ne pokreće (${p?.status})`);
  ok(p?.trosak === 0 || p?.trosak == null, 'odbijeno pokretanje ne košta');
  const zad = (await stanje()).zadaci.find((q) => q.id === z.id);
  ok(zad.status === 'novo' && zad.rezultat.includes('limit'), 'zadatak se vraća u "novo" s razlogom');
  const zahtjevi = await (await fetch(FAKE + '/zahtjevi')).json();
  ok(zahtjevi.length === Number(process.env.BROJ_ZAHTJEVA), `Claude API nije zvan nakon limita (${zahtjevi.length} zahtjeva)`);
}
