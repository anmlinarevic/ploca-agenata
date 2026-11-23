// API faze B (narudžbe, kalendar, skladište, norme) protiv pokrenutog dashboarda (DEV_USER='*').
// Okolina: URL (dashboard), neobavezno MCP + TOKEN (koordinator) za alate dohvati_*.
const URL_ = process.env.URL || 'http://localhost:8798';
const ok = (c, m) => { if (!c) { console.error('PAO:', m); process.exitCode = 1; } else console.log('ok  ', m); };
const blizu = (a, b, e = 1e-3) => Math.abs(a - b) < e;

async function zovi(metoda, put, tijelo, korisnik = 'vlasnik@test.hr', tenant) {
  const h = { 'x-dev-user': korisnik };
  if (tenant) h['x-tenant'] = tenant;
  if (tijelo !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(URL_ + put, { method: metoda, headers: h, body: tijelo !== undefined ? JSON.stringify(tijelo) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, d };
}
const pregled = async (od) => (await zovi('GET', '/api/poslovanje' + (od ? `?od=${od}` : ''))).d;
const art = (p, id) => p.skladiste.find((a) => a.id === id);
const dan = (k) => { const d = new Date(Date.now() + k * 86400000); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb' }).format(d); };

// artikli sa stranice
let p = await pregled();
ok(p.skladiste.filter((a) => a.kategorija === 'tkanina').length === 41 && art(p, 'spaga') && art(p, 'boxnow-s'), '41 tkanina sa stranice + ostali materijal');
ok(p.skladiste.every((a) => a.status === 'nepoznato'), 'bez upisa: sve „nije upisano”');
ok(p.norme.slovo_sirina_cm === 15 && p.norme.slovo_visina_cm === 15, 'norma: slovo 15 × 15 cm');

// skladište: inventura, ulaz u metrima, provjere
ok((await zovi('POST', '/api/skladiste/kretanja', { artikl: 'D12', vrsta: 'inventura', kolicina: 2 })).status === 200, 'inventura D12 = 2 m²');
const ulaz = await zovi('POST', '/api/skladiste/kretanja', { artikl: 'D21', vrsta: 'ulaz', metri: 1, sirina_cm: 150 });
ok(ulaz.status === 200 && blizu(ulaz.d.kolicina, 1.5), 'ulaz 1 m s bale 150 cm = 1,5 m²');
for (const [a, b, poruka] of [['spaga', 'inventura', 25], ['perle', 'inventura', 30], ['traka', 'inventura', 10], ['punilo', 'inventura', 2000]]) await zovi('POST', '/api/skladiste/kretanja', { artikl: a, vrsta: b, kolicina: poruka });
ok((await zovi('POST', '/api/skladiste/kretanja', { artikl: 'D12', vrsta: 'ulaz', kolicina: -1 })).status === 400, 'negativna količina se odbija');
ok((await zovi('POST', '/api/skladiste/kretanja', { artikl: 'X99', vrsta: 'ulaz', kolicina: 1 })).status === 404, 'nepoznat artikl → 404');
ok((await zovi('POST', '/api/skladiste/kretanja', { artikl: 'D12', vrsta: 'poklon', kolicina: 1 })).status === 400, 'nepoznata vrsta kretanja');

// narudžba šivanja
const banner = { proizvod: 'banner', tekst: 'lucija', dezeni: ['D12', 'D12', 'D12', 'D21'], motivi: [{ m: 'srce', dezen: 'D21' }] };
ok((await zovi('POST', '/api/narudzbe', { usluga: 'sivanje', opis: 'Banner, kupac ana@primjer.hr', stavke: [banner] })).status === 400, 'e-mail u opisu se odbija');
ok((await zovi('POST', '/api/narudzbe', { usluga: 'sivanje', opis: 'Banner 091 234 5678', stavke: [banner] })).status === 400, 'telefon u opisu se odbija');
ok((await zovi('POST', '/api/narudzbe', { usluga: 'sivanje', opis: 'Banner', stavke: [{ ...banner, dezeni: ['Z01'] }] })).status === 400, 'nepoznata tkanina se odbija');
const n1 = await zovi('POST', '/api/narudzbe', { usluga: 'sivanje', opis: 'Banner za krštenje', rok: dan(1), dostava: 'boxnow', stavke: [banner], izrada: [{ dan: dan(0), sati: 2 }] });
ok(n1.status === 200 && n1.d.sifra === 'N-0001', `nova narudžba ${n1.d?.sifra}`);
const n2 = await zovi('POST', '/api/narudzbe', { usluga: 'sivanje', opis: 'Tiha knjiga', stanje: 'ponuda', rok: dan(10), stavke: [{ proizvod: 'ostalo', opis: 'Tiha knjiga, 8 stranica', sati: 4 }], izrada: [{ dan: dan(0), sati: 4 }] });
ok(n2.d?.sifra === 'N-0002', 'druga narudžba dobiva sljedeću šifru');
ok((await zovi('POST', '/api/narudzbe', { usluga: 'sivanje', opis: 'Krivo stanje', stanje: 'gotovo' })).status === 400, 'nova narudžba ne može početi kao gotova');

p = await pregled();
let nar = p.narudzbe.find((x) => x.id === n1.d.id);
ok(nar.stanje === 'potvrdjeno' && nar.sati_procjena === 1.95 && nar.stavke[0].tekst === 'LUCIJA', 'zadano potvrđeno, procjena sati iz normi');
ok(blizu(art(p, 'D12').rezervirano, 0.2312) && blizu(art(p, 'D12').raspolozivo, 2 - 0.2312), `D12 rezervirano ${art(p, 'D12').rezervirano} m²`);
ok(art(p, 'D12').slova === 22, `D12: još ${art(p, 'D12').slova} slova`);
ok(art(p, 'boxnow-s').status === 'kriticno', 'BoxNow kutija rezervirana, a nema je na stanju → kritično');
ok(p.upozorenja.some((u) => u.vrsta === 'rok' && u.narudzba === n1.d.id), 'upozorenje: rok sutra, a nije gotovo');
const danasK = p.kalendar.dani.find((d) => d.datum === dan(0));
ok(danasK.sati === 6 && danasK.preko && p.upozorenja.some((u) => u.vrsta === 'kapacitet'), 'danas 6 h > 5 h: preopterećeno');

// izračun bez spremanja
const iz = await zovi('POST', '/api/izracun', { stavke: [{ proizvod: 'banner', tekst: 'EMA', dezeni: ['D21'] }] });
ok(iz.status === 200 && iz.d.slova === 3 && iz.d.stavke.find((x) => x.artikl === 'D21').dovoljno === true, 'izračun: EMA iz D21 može');

// prijelazi i automatska potrošnja
ok((await zovi('POST', `/api/narudzbe/${n1.d.id}/stanje`, { stanje: 'odradjeno' })).status === 409, 'stanje igraonice na šivanju se odbija');
ok((await zovi('POST', `/api/narudzbe/${n1.d.id}/stanje`, { stanje: 'u_izradi', version: 99 })).status === 409, 'stara verzija → 409');
const uIzradi = await zovi('POST', `/api/narudzbe/${n1.d.id}/stanje`, { stanje: 'u_izradi' });
ok(uIzradi.status === 200 && uIzradi.d.potrosnjaKnjizena >= 7, `u izradi: knjiženo ${uIzradi.d.potrosnjaKnjizena} stavki potrošnje`);
p = await pregled();
ok(blizu(art(p, 'D12').stanje, 2 - 0.2312) && art(p, 'D12').rezervirano === 0, 'D12: skinuto sa stanja, više nije rezervirano');
ok(blizu(art(p, 'spaga').stanje, 25 - 1.86) && art(p, 'perle').stanje === 28, 'špaga i perle skinute');
ok((await zovi('PUT', `/api/narudzbe/${n1.d.id}`, { stavke: [banner] })).status === 409, 'nakon krojenja stavke se ne mijenjaju');
ok((await zovi('PUT', `/api/narudzbe/${n1.d.id}`, { izrada: [{ dan: dan(0), sati: 1 }], opis: 'Banner za krštenje, 2 motiva' })).status === 200, 'dan izrade i opis se mogu mijenjati');
await zovi('POST', `/api/narudzbe/${n1.d.id}/stanje`, { stanje: 'gotovo' });
ok((await zovi('POST', `/api/narudzbe/${n1.d.id}/stanje`, { stanje: 'u_izradi' })).d.potrosnjaKnjizena === 0, 'povratak u izradu ne knjiži potrošnju dvaput');
await zovi('POST', `/api/narudzbe/${n1.d.id}/stanje`, { stanje: 'gotovo' });
ok((await zovi('POST', `/api/narudzbe/${n1.d.id}/stanje`, { stanje: 'isporuceno' })).status === 200, 'isporučeno');
p = await pregled();
nar = p.narudzbe.find((x) => x.id === n1.d.id);
ok(nar.stavke[0].tekst === '••••••' && nar.stavke[0].dezeni.length === 6, 'nakon isporuke ime na banneru je maskirano');
ok(blizu(art(p, 'D12').tempoTjedno, 0.2312 / 4), 'tempo potrošnje iz zadnja 4 tjedna');
ok((await zovi('POST', `/api/narudzbe/${n1.d.id}/stanje`, { stanje: 'otkazano' })).status === 409, 'isporučena se ne može otkazati');
ok((await zovi('POST', `/api/narudzbe/${n2.d.id}/stanje`, { stanje: 'otkazano' })).status === 200, 'ponuda se otkazuje');

// igraonica
const sutra = dan(1);
const opcijaDo = new Date(Date.now() + 10 * 3600000).toISOString();
const r1 = await zovi('POST', '/api/narudzbe', { usluga: 'igraonica', opis: 'Rođendan u stanu', termin_od: `${sutra}T10:00`, termin_do: `${sutra}T13:00`, opcija_do: opcijaDo, dostava: 'montaza' });
ok(r1.status === 200 && r1.d.sifra === 'R-001', 'rezervacija igraonice kao opcija');
ok((await zovi('POST', '/api/narudzbe', { usluga: 'igraonica', opis: 'Krivi termin', termin_od: `${sutra}T13:00`, termin_do: `${sutra}T10:00` })).status === 400, 'kraj prije početka se odbija');
const r2 = await zovi('POST', '/api/narudzbe', { usluga: 'igraonica', opis: 'Drugi rođendan', stanje: 'potvrdjeno', termin_od: `${sutra}T16:00` });
p = await pregled(sutra);
ok(p.upozorenja.some((u) => u.vrsta === 'opcija' && /ističe za (9|10) h/.test(u.tekst)), 'opcija ističe za ~10 h');
ok(p.upozorenja.some((u) => u.vrsta === 'sukob'), 'dvije rezervacije isti dan');
ok(p.kalendar.dani.find((d) => d.datum === sutra).igraonica.length === 2, 'oba termina na kalendaru');
ok((await zovi('POST', `/api/narudzbe/${r1.d.id}/stanje`, { stanje: 'potvrdjeno' })).status === 200, 'opcija potvrđena');
ok((await zovi('POST', `/api/narudzbe/${r2.d.id}/stanje`, { stanje: 'otkazano' })).status === 200, 'druga rezervacija otkazana');
p = await pregled(sutra);
ok(!p.upozorenja.some((u) => u.vrsta === 'sukob' || u.vrsta === 'opcija'), 'nakon potvrde i otkaza nema upozorenja za igraonicu');

// norme
ok((await zovi('PUT', '/api/norme', { iskoristivost: 2 })).status === 400, 'iskoristivost > 1 se odbija');
ok((await zovi('PUT', '/api/norme', { nepostoji: 1 })).status === 400, 'nepoznata norma se odbija');
ok((await zovi('PUT', '/api/norme', { slojevi: 1 })).status === 200, 'norma: jedan sloj');
const iz2 = await zovi('POST', '/api/izracun', { stavke: [{ proizvod: 'banner', tekst: 'A', dezeni: ['D12'] }] });
ok(blizu(iz2.d.stavke.find((x) => x.artikl === 'D12').kolicina, 0.0385), 'jedan sloj: pola tkanine po slovu');
await zovi('PUT', '/api/norme', { slojevi: 2 });

// prag
ok((await zovi('PUT', '/api/artikli/D21', { prag: 2 })).status === 200, 'prag po tkanini');
p = await pregled();
ok(art(p, 'D21').status === 'uskoro', 'D21 ispod praga → naruči uskoro');

// zakupci
const tudje = await zovi('GET', '/api/poslovanje', undefined, 'savjetnik@test.hr', 'drugi');
ok(tudje.status === 200 && tudje.d.skladiste.length === 0 && tudje.d.narudzbe.length === 0, 'drugi zakupac ne vidi Piccolinijevo skladište ni narudžbe');
ok((await zovi('POST', `/api/narudzbe/${r1.d.id}/stanje`, { stanje: 'odradjeno' }, 'savjetnik@test.hr', 'drugi')).status === 404, 'narudžba se ne mijenja kroz tuđeg zakupca');

// MCP: agenti čitaju isto
if (process.env.MCP && process.env.TOKEN) {
  const mcp = async (name, args = {}) => {
    const r = await fetch(process.env.MCP + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.TOKEN },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return JSON.parse((await r.json()).result.content[0].text);
  };
  const s = await mcp('dohvati_skladiste');
  ok(s.skladiste.find((a) => a.id === 'D21').status === 'uskoro' && s.norme.slovo_sirina_cm === 15, 'MCP dohvati_skladiste');
  const k = await mcp('dohvati_kalendar', { od: sutra });
  ok(k.kalendar.dani.some((d) => d.igraonica.length === 1), 'MCP dohvati_kalendar');
  const nz = await mcp('dohvati_narudzbe');
  ok(nz.length >= 3 && !JSON.stringify(nz).includes('LUCIJA'), 'MCP dohvati_narudzbe, bez imena s isporučenog bannera');
}
