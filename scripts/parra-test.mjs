// Parra → kalendar, protiv pokrenutog dashboarda (DEV_USER='*') i lažnog Parra API-ja (scripts/fake-parra.mjs).
// Okolina: URL (dashboard), PARRA (lažni Parra).
const URL_ = process.env.URL || 'http://localhost:8798';
const PARRA = process.env.PARRA || 'http://localhost:8791';
const ok = (c, m) => { if (!c) { console.error('PAO:', m); process.exitCode = 1; } else console.log('ok  ', m); };
const dan = (k) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb' }).format(new Date(Date.now() + k * 86400000));

async function zovi(metoda, put, tijelo, korisnik = 'vlasnik@test.hr', tenant) {
  const h = { 'x-dev-user': korisnik };
  if (tenant) h['x-tenant'] = tenant;
  if (tijelo !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(URL_ + put, { method: metoda, headers: h, body: tijelo !== undefined ? JSON.stringify(tijelo) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, d, t };
}
const pregled = async (q = '') => (await zovi('GET', '/api/poslovanje' + q)).d;
const naDan = (p, datum) => p.kalendar.dani.find((d) => d.datum === datum)?.ponude ?? [];

let p = await pregled();
ok(p.parra.spojeno === false && Array.isArray(p.ponude) && p.kalendar.pogled === 'tjedan', 'prije prve sinkronizacije: Parra nije spojena, zadani pogled je tjedan');

const s1 = await zovi('POST', '/api/parra/osvjezi', {});
ok(s1.status === 200 && s1.d.promijenjeno === 6 && s1.d.ukupno === 6, `prva sinkronizacija: ${s1.d?.promijenjeno} ponuda` + (s1.d?.promijenjeno === 6 ? '' : ` (${s1.status} ${s1.t})`));

p = await pregled(`?od=${dan(3)}`);
ok(naDan(p, dan(3)).some((x) => x.broj === '101-1-1' && x.stanje === 'poslana'), 'izdana ponuda na dan isporuke kao „poslana”');
ok(!p.kalendar.dani.some((d) => d.ponude.some((x) => x.broj === '104-1-1')), 'odbijena ponuda nije na kalendaru');
const p102 = p.ponude.find((x) => x.broj === '102-1-1');
ok(p102 && p102.stanje === 'placeno' && p102.placeno === 64, 'prihvaćena ponuda s plaćenim računom = plaćeno');
ok(p.ponude.some((x) => x.broj === '106-1-1' && !x.isporuka_od), 'ponuda bez datuma isporuke je na popisu');
ok(p.upozorenja.some((u) => u.vrsta === 'naplata' && u.tekst.includes('105-1-1')), 'upozorenje: isporučeno prije 3 dana, račun nije plaćen');
ok(p.parra.spojeno && !p.parra.greska && p.parra.zadnjeUspjesno, 'stanje sinkronizacije na ekranu');
ok(!/Ana|Anić|ana@|091 234|Ulica 1|12345678901|LUCIJA/.test(JSON.stringify(p)), 'na ploči nema imena kupca, kontakta, OIB-a, adrese ni opisa stavke');

const m = await pregled(`?pogled=mjesec&od=${dan(10)}`);
ok(m.kalendar.pogled === 'mjesec' && m.kalendar.dani.length % 7 === 0 && m.kalendar.dani.length >= 28, `mjesečni pogled: ${m.kalendar.dani.length} dana`);
const raz = [dan(10), dan(11), dan(12)].filter((d) => m.kalendar.dani.some((x) => x.datum === d));
ok(raz.every((d) => naDan(m, d).some((x) => x.broj === '103-1-1' && x.razdoblje && x.stanje === 'prihvacena')), 'najam s razdobljem na svim danima, „rezervirano”');
ok(naDan(m, dan(10)).find((x) => x.broj === '103-1-1')?.usluga === 'igraonica' && p.ponude.find((x) => x.broj === '102-1-1')?.usluga === 'sivanje',
  'ponuda ide u red svoje usluge: najam igraonice → igraonica, banner → šivanje');

const s2 = await zovi('POST', '/api/parra/osvjezi', {});
ok(s2.status === 200 && s2.d.promijenjeno === 0, 'druga sinkronizacija: ništa novo (delta po updatedSince + afterId)');

await fetch(PARRA + '/prihvati/101', { method: 'POST' });
const s3 = await zovi('POST', '/api/parra/osvjezi', {});
p = await pregled(`?od=${dan(3)}`);
ok(s3.d.promijenjeno === 1 && naDan(p, dan(3)).some((x) => x.broj === '101-1-1' && x.stanje === 'prihvacena'), 'ponuda prihvaćena u Parri → na kalendaru „rezervirano”');

await fetch(PARRA + '/pokvari', { method: 'POST' });
const s4 = await zovi('POST', '/api/parra/osvjezi', {});
ok(s4.status === 502 && /ključ/i.test(s4.d.greska), `neispravan ključ: jasna poruka (${s4.d?.greska})`);
p = await pregled();
ok(p.parra.greska && p.ponude.length === 5, 'greška se vidi na ekranu, stari podaci ostaju');
await fetch(PARRA + '/popravi', { method: 'POST' });
ok((await zovi('POST', '/api/parra/osvjezi', {})).status === 200, 'nakon popravka opet radi');

const zahtjevi = await (await fetch(PARRA + '/zahtjevi')).json();
ok(zahtjevi.zadnji.every((z) => z.startsWith('GET ')), 'prema Parri idu samo GET zahtjevi');

const tudje = await zovi('POST', '/api/parra/osvjezi', {}, 'savjetnik@test.hr', 'drugi');
ok(tudje.status === 503, 'drugi zakupac nema Parru');
const tp = await zovi('GET', '/api/poslovanje', undefined, 'savjetnik@test.hr', 'drugi');
ok(tp.status === 200 && tp.d.ponude.length === 0, 'drugi zakupac ne vidi Piccolinijeve ponude');
ok(!/test-parra/.test(JSON.stringify(p)) && !/test-parra/.test(tp.t), 'ključ se nikad ne vraća pregledniku');
