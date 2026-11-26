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
const sviZahtjevi = async () => (await fetch(FAKE + '/zahtjevi')).json();
// Odobrenje odluke u ranijim testovima pokreće koordinatora i agenta: pričekaj da red bude prazan.
const mirno = () => cekaj((s) => (s.pokretanja.every(zavrseno) ? s : null), 150000);

if (faza === 'faza1') {
  ok(await mirno(), 'red pokretanja je prazan prije testa');
  const pocetno = (await sviZahtjevi()).length;
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
  ok(zad.rezultat.endsWith('KRAJ SAŽETKA') && p1.rezultat.endsWith('KRAJ SAŽETKA'),
    `dug rezultat agenta spremljen je cijeli, i u zadatku i u pokretanju (${zad.rezultat.length} znakova)`);
  ok(s.izvjestaji.some((x) => x.naslov === 'Konkurencija (test)' && x.agent === 'konkurencija'), 'izvještaj je spremljen kroz MCP');
  ok(s.konkurenti.find((k) => k.id === 'imemojemalo').napomena === 'Lažna provjera', 'registar konkurenata ažuriran kroz MCP');
  ok(s.potrosnja.potroseno > 0 && s.potrosnja.limit === 20, 'potrošnja i limit u sažetku');

  // 2. što je stvarno poslano Claude API-ju
  const zahtjevi = (await sviZahtjevi()).slice(pocetno).filter((q) => q.agent === 'konkurencija');
  const prvi = zahtjevi[0];
  ok(prvi.model === 'claude-sonnet-5-5' && prvi.effort === 'medium' && prvi.cache, 'model, effort i cache_control su postavljeni');
  ok(prvi.fallbacks === 'default' && String(prvi.beta).includes('server-side-fallback-2026-07-01'), 'rezervni model kad glavni odbije (fallbacks)');
  ok(prvi.alati.includes('web_search') && prvi.alati.includes('web_fetch') && prvi.alati.includes('azuriraj_konkurenta'), 'konkurencija dobiva web alate i svoje alate ploče');
  ok(!prvi.alati.includes('upisi_mjesecno') && !prvi.alati.includes('azuriraj_odluku_izvrsenje') && !prvi.alati.includes('zadaj_zadatak'), 'ne dobiva tuđe alate (token ih ne dopušta)');
  const povrat = zahtjevi[2].zadnjaPoruka;
  ok(povrat.role === 'user' && povrat.content.length === 3 && povrat.content.every((c) => c.type === 'tool_result'), 'svi rezultati alata vraćeni u jednoj poruci');
  ok(povrat.content[2].is_error === true, 'nepostojeći alat vraća is_error, ne ruši pokretanje');

  // 3. tjedni pregled: lanac konkurencija -> koordinator
  const prije = s.pokretanja.length;
  const pr = await zovi('POST', '/api/pregled', {});
  ok(pr.status === 200, 'tjedni pregled se stavlja u red');
  const lanac = await cekaj((q) => { const novi = q.pokretanja.filter((p) => p.vrsta === 'pregled_tjedni'); return novi.length >= 2 && novi.every(zavrseno) ? novi : null; });
  ok(lanac && lanac.length === 2 && lanac.every((p) => p.status === 'uspjeh'), 'lanac: oba agenta uspješna');
  ok(lanac && lanac.some((p) => p.agent === 'koordinator'), 'koordinator se pokreće nakon konkurencije');
  s = await stanje();
  ok(s.izvjestaji.some((x) => x.naslov === 'Tjedni pregled (test)' && x.agent === 'koordinator'), 'sažetak koordinatora spremljen');
  const iz = (await zovi('GET', '/api/izvjestaj/' + s.izvjestaji.find((x) => x.agent === 'koordinator').id)).d;
  ok(iz.tijelo.includes('Za odluku'), 'cijeli tekst izvještaja se dohvaća');

  // 3b. mjesečni pregled: konkurencija -> seo -> ai -> sadrzaj -> lokalno -> koordinator
  const mj = await zovi('POST', '/api/pregled', { vrsta: 'mjesecni' });
  ok(mj.status === 200, 'mjesečni pregled se stavlja u red');
  const lanacMj = await cekaj((q) => { const novi = q.pokretanja.filter((p) => p.vrsta === 'pregled_mjesecni'); return novi.length >= 6 && novi.every(zavrseno) ? novi : null; }, 150000);
  ok(lanacMj && lanacMj.length === 6 && lanacMj.every((p) => p.status === 'uspjeh'), `mjesečni lanac: svih 6 agenata uspješno (${lanacMj?.map((p) => p.agent + ':' + p.status).join(', ')})`);
  ok(lanacMj && JSON.stringify(lanacMj.map((p) => p.agent).sort()) === JSON.stringify(['ai', 'konkurencija', 'koordinator', 'lokalno', 'sadrzaj', 'seo']), 'lanac sadrži točno ove agente (bez oglasa)');
  s = await stanje();
  for (const ime of ['SEO pregled (test)', 'ai (test)', 'sadrzaj (test)', 'lokalno (test)']) ok(s.izvjestaji.some((x) => x.naslov === ime), `izvještaj spremljen: ${ime}`);
  // registar koji je SEO agent ažurirao, provjera izravno na MCP-u
  if (process.env.MCP && process.env.TOKEN) {
    const mcp = async (name, args) => {
      const r = await fetch(process.env.MCP + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.TOKEN },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      return JSON.parse((await r.json()).result.content[0].text);
    };
    const reg = await mcp('dohvati_registar', { kljuc: 'kljucne-rijeci' });
    ok(reg.verzija >= 3 && reg.tijelo.includes('Test dodatak (SEO)') && reg.tijelo.includes('test koordinator') && reg.azurirao === 'agent:seo', 'SEO agent je ažurirao registar ključnih riječi, uz zadržane ranije promjene');
    const partneri = await mcp('dohvati_registar', { kljuc: 'partneri' });
    ok(partneri.verzija === 1 && partneri.azurirao === 'uvoz', 'SEO nije mogao promijeniti registar partnera');
    const zahtjevi2 = await (await fetch(FAKE + '/zahtjevi')).json();
    const seoZadnji = zahtjevi2.filter((z) => z.agent === 'seo')[2].zadnjaPoruka.content;
    ok(seoZadnji[0].is_error !== true && seoZadnji[1].is_error === true, 'zabranjeni registar vraća is_error agentu');
    ok(zahtjevi2.find((z) => z.agent === 'seo').alati.includes('web_fetch') && !zahtjevi2.find((z) => z.agent === 'seo').alati.includes('web_search'), 'SEO ima samo dohvat stranica, bez pretrage');
    ok(zahtjevi2.find((z) => z.agent === 'oglasi') === undefined, 'oglasi se ne pokreću u pregledu');
  }

  // 4. agent kojeg izvršitelj još nema
  const z2 = (await zovi('POST', '/api/zadaci', { agent: 'materijal', opis: 'Provjera cijena materijala (test)' })).d;
  const r2 = await zovi('POST', `/api/zadaci/${z2.id}/pokreni`, {});
  ok(r2.status === 422 && r2.d.greska.includes('još nije dostupan'), 'agent bez definicije: jasna poruka, zadatak ostaje novi');
  ok((await stanje()).zadaci.find((q) => q.id === z2.id).status === 'novo', 'zadatak ostaje "novo"');

  // 5. razgovor: vlasnik piše koordinatoru → koordinator daje posao Sadržaju i traži pristup → Sadržaj radi sam → obavijest u razgovoru
  ok(await mirno(), 'red je prazan prije razgovora');
  const prijeR = (await sviZahtjevi()).length;
  ok((await zovi('POST', '/api/razgovor', { tekst: '   ' })).status === 400, 'prazna poruka se odbija');
  const por = await zovi('POST', '/api/razgovor', { tekst: 'Napiši nacrt vodiča o poklonu za krštenje (test).' });
  ok(por.status === 200 && por.d.id && por.d.pokretanje_id && !por.d.greska, 'poruka koordinatoru pokreće koordinatora');
  let raz = null;
  for (let i = 0; i < 80 && !raz; i++) {
    const r = (await zovi('GET', '/api/razgovor')).d;
    if (r.poruke.some((m) => m.tko === 'ploca') && !r.koordinatorRadi && r.agentiRade === 0) raz = r;
    else await new Promise((x) => setTimeout(x, 1500));
  }
  ok(raz, 'razgovor stiže do obavijesti ploče');
  ok(raz?.poruke.some((m) => m.tko === 'ti' && m.tekst.includes('poklonu za krštenje')), 'poruka vlasnika je u razgovoru');
  ok(raz?.poruke.some((m) => m.tko === 'koordinator' && m.tekst.startsWith('Dao sam Sadržaju')), 'koordinator odgovara u razgovoru');
  ok(raz?.poruke.some((m) => m.tko === 'ploca' && m.tekst.startsWith('Sadržaj je završio')), 'obavijest u razgovoru kad agent završi');
  let s5 = await stanje();
  const zk = s5.zadaci.find((q) => q.zadao === 'koordinator' && q.razgovorId === por.d.id);
  ok(zk && zk.agent === 'sadrzaj' && zk.automatski && zk.status === 'gotovo', 'zadatak koji je dao koordinator pokrenuo se sam i završio');
  const pristupGit = s5.pristupi.find((p) => p.status === 'otvoreno' && p.sto.includes('GitHub'));
  ok(pristupGit && pristupGit.kako, 'koordinator zapisuje pristup koji fali');
  const zr = (await sviZahtjevi()).slice(prijeR);
  const kz = zr.find((q) => q.agent === 'koordinator'), sz = zr.find((q) => q.agent === 'sadrzaj');
  ok(kz?.model === 'claude-opus-5-5' && kz.alati.includes('zadaj_zadatak') && kz.alati.includes('zatrazi_pristup'), 'koordinator radi na Opusu s alatima za raspoređivanje');
  ok(kz?.zadnjaPoruka.role === 'user' && JSON.stringify(kz.zadnjaPoruka).includes('Razgovor na ploči'), 'koordinator dobiva razgovor kao poruke');
  ok(sz?.model === 'claude-sonnet-5-5' && !sz.alati.includes('zadaj_zadatak'), 'agent radi na Sonnetu, bez alata koordinatora');
  ok(JSON.stringify(sz?.zadnjaPoruka || '').includes('Radi samo ovaj zadatak'), 'agent dobiva zadatak koordinatora s uputom da radi samo njega');
  ok((await zovi('POST', `/api/pristupi/${pristupGit.id}/status`, { status: 'rijeseno' })).status === 200, 'vlasnik označi pristup riješenim');
  ok((await zovi('POST', `/api/pristupi/${pristupGit.id}/status`, { status: 'rijeseno' })).status === 409, 'riješen pristup se ne mijenja dvaput');

  // 6. odobrena odluka → koordinator → Sadržaj → odluka zatvorena s rezultatom
  const ceka = s5.odluke.find((o) => o.status === 'ceka');
  const od = await zovi('POST', `/api/odluke/${ceka.id}/odluka`, { status: 'odobreno' });
  ok(od.status === 200 && od.d.koordinator === true, 'odobrena odluka odmah ide koordinatoru');
  ok((await zovi('POST', `/api/odluke/${ceka.id}/rasporedi`, {})).status === 409, 'ista odluka se ne raspoređuje dvaput dok je kod koordinatora');
  const gotova = await cekaj((s) => { const o = s.odluke.find((x) => x.id === ceka.id); return o.status === 'gotovo' && s.pokretanja.every(zavrseno) ? o : null; }, 120000);
  ok(gotova && gotova.rezultat.startsWith('Sadržaj') && !gotova.cekaTebe, `agent je izvršio odluku i zatvorio je (${gotova?.status}: ${gotova?.rezultat})`);
  s5 = await stanje();
  ok(s5.zadaci.some((q) => q.odlukaId === ceka.id && q.status === 'gotovo'), 'zadatak je vezan uz odluku');
  ok((await zovi('POST', `/api/odluke/${ceka.id}/napravljeno`, {})).status === 409, 'zatvorena odluka se ne može ponovno označiti');
}

if (faza === 'faza2') {
  // Limit je prije ove faze postavljen na 0,01 USD, a potrošeno je više
  const prije = (await sviZahtjevi()).length;
  const z = (await zovi('POST', '/api/zadaci', { agent: 'koordinator', opis: 'Zadatak nakon limita (test)' })).d;
  const pk = await zovi('POST', `/api/zadaci/${z.id}/pokreni`, {});
  const p = await cekaj((s) => s.pokretanja.find((q) => q.id === pk.d.pokretanje_id && zavrseno(q)));
  ok(p?.status === 'odbijeno_limit', `iznad limita se agent ne pokreće (${p?.status})`);
  ok(p?.trosak === 0 || p?.trosak == null, 'odbijeno pokretanje ne košta');
  const zad = (await stanje()).zadaci.find((q) => q.id === z.id);
  ok(zad.status === 'novo' && zad.rezultat.includes('limit'), 'zadatak se vraća u "novo" s razlogom');
  const poslije = (await sviZahtjevi()).length;
  ok(poslije === prije, `Claude API nije zvan nakon limita (${prije} → ${poslije} zahtjeva)`);
  // poruka koordinatoru iznad limita: odgovor u razgovoru objašnjava zašto
  const por = await zovi('POST', '/api/razgovor', { tekst: 'Ima li što novo? (test limita)' });
  const odg = await (async () => {
    for (let i = 0; i < 40; i++) {
      const r = (await zovi('GET', '/api/razgovor')).d;
      const m = r.poruke.filter((x) => x.tko === 'koordinator').pop();
      if (m && m.tekst.includes('limit')) return m;
      await new Promise((x) => setTimeout(x, 1500));
    }
    return null;
  })();
  ok(por.status === 200 && odg, 'iznad limita koordinator u razgovoru javlja da je limit dosegnut');
  ok((await sviZahtjevi()).length === prije, 'ni razgovor ne zove Claude API iznad limita');
}
