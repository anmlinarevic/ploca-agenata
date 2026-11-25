// Meta (Instagram + Facebook stranica) → ekran Mreže, protiv pokrenutog dashboarda (DEV_USER='*') i lažne Mete (scripts/fake-meta.mjs).
// Okolina: URL (dashboard), META (lažna Meta).
const URL_ = process.env.URL || 'http://localhost:8798';
const META = process.env.META || 'http://localhost:8792';
const ok = (c, m) => { if (!c) { console.error('PAO:', m); process.exitCode = 1; } else console.log('ok  ', m); };

async function zovi(metoda, put, tijelo, korisnik = 'vlasnik@test.hr', tenant) {
  const h = { 'x-dev-user': korisnik };
  if (tenant) h['x-tenant'] = tenant;
  if (tijelo !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(URL_ + put, { method: metoda, headers: h, body: tijelo !== undefined ? JSON.stringify(tijelo) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, d, t };
}
const mreze = async () => (await zovi('GET', '/api/mreze')).d;

let p = await mreze();
ok(p.meta.spojeno && !p.meta.zadnje && p.kanali.instagram.objave.length === 0, 'prije prve sinkronizacije: spojeno, ali još nema podataka');

const s1 = await zovi('POST', '/api/meta/osvjezi', {});
ok(s1.status === 200 && s1.d.objava === 15 && s1.d.uvida === 15, `prva sinkronizacija: ${s1.d?.objava} objava, ${s1.d?.uvida} uvida` + (s1.status === 200 ? '' : ` (${s1.status} ${s1.t})`));

p = await mreze();
const ig = p.kanali.instagram, fb = p.kanali.facebook;
ok(p.meta.igIme === 'piccoliniplay' && p.meta.stranicaIme === 'Piccolini Play' && !p.meta.greska, 'račun i stranica su prepoznati');
ok(ig.pratitelji === 1284 && fb.pratitelji === 842, 'pratitelji na Instagramu i Facebooku');
ok(ig.doseg28 === 14200 && ig.dosegPromjena === 27 && ig.pregledi28 === 26400, `Instagram: doseg 28 dana i promjena (${ig.dosegPromjena} %)`);
ok(ig.graf.length === 10 && ig.prosjekZadnjih5 > ig.prosjekPrethodnih5 && ig.promjena5 > 0, `zadnjih 5 naspram prethodnih 5 (+${ig.promjena5} %)`);
ok(ig.najbolje && p.sati[ig.najbolje.sat] === 20 && ig.najbolje.objava >= 2, 'kad objaviti: najbolje oko 20 h');
ok(ig.uvidi.some((u) => /Reelsi imaju/.test(u.tekst)) && ig.uvidi.some((u) => /Najviše spremanja/.test(u.tekst)), 'uvidi: reelsi naspram ostalog, najviše spremanja');
const stara = ig.objave.find((o) => o.opis === 'Igraonica spremna za vikend') || null;
ok(ig.ukupnoObjava === 11 && stara && stara.pregledi == null && stara.doseg > 0, 'starija objava bez metrike views: doseg i spremanja ipak stižu');
ok(!/ana\.kupac|091 234/.test(JSON.stringify(p)), 'opis objave bez @oznaka i brojeva telefona');
ok(fb.pregledi28 === 6900 && fb.objave.length === 4 && fb.objave.every((o) => o.pregledi > 0) && fb.objave.some((o) => o.lajkovi > 0), 'Facebook: pregledi stranice i objava, reakcije');

const s2 = await zovi('POST', '/api/meta/osvjezi', {});
ok(s2.status === 200 && s2.d.uvida === 0, 'druga sinkronizacija: uvidi se ne traže ponovno unutar 20 sati');
await fetch(META + '/nova-objava', { method: 'POST' });
const s3 = await zovi('POST', '/api/meta/osvjezi', {});
ok(s3.d.uvida === 1 && (await mreze()).kanali.instagram.ukupnoObjava === 12, 'nova objava dobije uvide u idućem krugu');

await fetch(META + '/pokvari', { method: 'POST' });
const s4 = await zovi('POST', '/api/meta/osvjezi', {});
ok(s4.status === 502 && /token/i.test(s4.d.greska), `istekao token: jasna poruka (${s4.d?.greska})`);
p = await mreze();
ok(p.meta.greska && p.kanali.instagram.ukupnoObjava === 12, 'greška se vidi na ekranu, stari podaci ostaju');
await fetch(META + '/popravi', { method: 'POST' });
ok((await zovi('POST', '/api/meta/osvjezi', {})).status === 200 && !(await mreze()).meta.greska, 'nakon popravka opet radi');

const z = await (await fetch(META + '/zahtjevi')).json();
ok(z.zadnji.every((x) => x.startsWith('GET ')), 'prema Meti idu samo GET zahtjevi');
ok(z.zadnji.every((x) => !/access_token/.test(x)), 'token ide u zaglavlje, ne u adresu');

const tudje = await zovi('POST', '/api/meta/osvjezi', {}, 'savjetnik@test.hr', 'drugi');
ok(tudje.status === 503, 'drugi zakupac nema Metu');
const tp = await zovi('GET', '/api/mreze', undefined, 'savjetnik@test.hr', 'drugi');
ok(tp.status === 200 && tp.d.kanali.instagram.objave.length === 0 && !tp.d.meta.spojeno, 'drugi zakupac ne vidi Piccolinijeve mreže');
ok(!/test-meta/.test(JSON.stringify(p)) && !/test-meta/.test(tp.t), 'token se nikad ne vraća pregledniku');
