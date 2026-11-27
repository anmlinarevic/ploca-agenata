// Prodaja po razdoblju: upiti (tjedni unos s izvorima) i ponude iz Parre, zaokruživanje na cijele tjedne, usporedba s prethodnim.
// Bez wranglera. Upotreba: node scripts/prodaja-razdoblje-test.mjs
import { d1, nova } from './d1-sqlite.mjs';
import { pregledProdaje, razdobljeProdaje, tjedniUnutar, zbrojUpita } from '../packages/poslovanje/prodaja.js';

let pali = 0;
const ok = (c, m) => { if (!c) { console.error('PAO:', m); pali++; process.exitCode = 1; } else console.log('ok  ', m); };
const baca = (f, re, m) => { try { f(); ok(false, `${m} (nije bacilo grešku)`); } catch (e) { ok(re.test(e.message), `${m} (${e.message})`); } };

// 2026-11-25 je srijeda; jučer je utorak 24. 11.; zadnja završena nedjelja je 22. 11.
const sada = new Date('2026-11-25T10:00:00Z'), danas = '2026-11-25';
let r = razdobljeProdaje({}, danas);
ok(r.do === '2026-11-22' && r.od === '2026-10-26' && r.dana === 28, 'zadano: 28 dana do kraja zadnjeg završenog tjedna (4 tjedna)');
r = razdobljeProdaje({ dana: '90' }, danas); ok(r.dana === 90 && r.do === '2026-11-22', '90 dana');
r = razdobljeProdaje({ od: '2026-09-01', do: '2026-10-31' }, danas); ok(r.prilagodeno && r.dana === 61, 'prilagođeno od-do');
baca(() => razdobljeProdaje({ dana: '3' }, danas), /7 do 366/, 'prekratko razdoblje');
baca(() => razdobljeProdaje({ od: '2026-11-01', do: '2026-11-05' }, danas), /najmanje 7/, 'prilagođeno kraće od tjedna');
baca(() => razdobljeProdaje({ od: '2026-11-01', do: '2026-11-25' }, danas), /najkasnije jučer/, 'kraj nije jučer ili prije');
baca(() => razdobljeProdaje({ od: '2026-12-1', do: '2026-12-10' }, danas), /YYYY-MM-DD/, 'neispravan oblik datuma');
baca(() => razdobljeProdaje({ od: '2026-10-10', do: '2026-10-01' }, danas), /prije kraja/, 'početak nakon kraja');
baca(() => razdobljeProdaje({ od: '2025-01-01', do: '2026-11-20' }, danas), /najviše 366/, 'predugo razdoblje');

const tj = (od, b, i, iz) => ({ od, upiti_banner: b, upiti_igraonica: i, izvori_json: JSON.stringify(iz) });
const rd = [tj('2026-10-26', 5, 2, { instagram: 4, google: 2, preporuka: 1 }), tj('2026-11-02', 8, 1, { instagram: 5, facebook: 2, tiktok: 1, ostalo: 1 }), tj('2026-11-09', 6, 3, { instagram: 3, google: 3, preporuka: 3 }), tj('2026-11-16', 9, 2, { instagram: 6, google: 3, ai: 2 })];
ok(tjedniUnutar(rd, '2026-10-26', '2026-11-22').length === 4 && tjedniUnutar(rd, '2026-10-27', '2026-11-22').length === 3, 'samo cijeli tjedni unutar razdoblja');
const z = zbrojUpita(rd);
ok(z.n === 36 && z.banner === 28 && z.igraonica === 8 && z.izvori.instagram === 18 && z.izvori.tiktok === 1 && z.izvori.google === 8, `zbroj upita i izvora (${z.n})`);
ok(zbrojUpita([{ upiti_banner: 3, upiti_igraonica: null, izvori_json: 'nije json' }]).n === 3, 'pokvaren izvori_json ne ruši zbroj');

const db = nova(); const E = { DB: d1(db) };
for (const t of [...rd, tj('2026-10-19', 4, 2, { instagram: 3, google: 1, preporuka: 2 }), tj('2026-10-12', 3, 1, { instagram: 2, google: 2 })])
  db.prepare(`INSERT INTO tjedni (tenant_id, tjedan, od, upiti_banner, upiti_igraonica, izvori_json) VALUES ('t1', ?, ?, ?, ?, ?)`).run(`W${t.od}`, t.od, t.upiti_banner, t.upiti_igraonica, t.izvori_json);
// ponude: [id, datum_ponude, status, iznos, naziv, ima račun, placeno, za_platiti]
const ponude = [[1, '2026-10-12', 'Accepted', 50, 'Banner s imenom', 1, 50, 50], [2, '2026-10-20', 'Accepted', 200, 'Soft play igraonica', 1, 200, 200], [3, '2026-10-28', 'Accepted', 60, 'Banner s imenom', 1, 60, 60],
  [4, '2026-11-03', 'Accepted', 250, 'Soft play igraonica', 0, null, null], [5, '2026-11-10', 'Issued', 70, 'Banner s imenom', 0, null, null], [6, '2026-11-12', 'Accepted', 80, 'Banner s imenom', 1, 40, 80],
  [7, '2026-11-18', 'Denied', 90, 'Banner s imenom', 0, null, null], [8, '2026-11-23', 'Issued', 55, 'Banner s imenom', 0, null, null]];
for (const [id, dp, st, iznos, naziv, rac, pl, zp] of ponude)
  db.prepare(`INSERT INTO parra_ponude (tenant_id, id, broj, status, datum_ponude, isporuka_od, isporuka_do, iznos, valuta, stavke_json, racuni_json, placeno, za_platiti, sinkronizirano)
    VALUES ('t1', ?, ?, ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, '2026-11-25T00:00:00Z')`).run(id, `${id}-1-1`, st, dp, dp, dp, iznos, JSON.stringify([{ naziv, kolicina: 1, jedinica: 'kom' }]), JSON.stringify(rac ? [{ id: 100 + id, broj: 'R', status: 'Issued' }] : []), pl, zp);

let p = await pregledProdaje(E, 't1', sada);
ok(p.razdoblje.od === '2026-10-26' && p.razdoblje.do === '2026-11-22' && p.razdoblje.tjedana === 4 && p.razdoblje.ocekivano === 4, 'zadano razdoblje: 4 tjedna, sva 4 uneseno');
ok(p.upiti.n === 36 && p.upiti.izvori.instagram === 18, 'upiti u razdoblju po izvoru');
ok(p.ponude.poslane.n === 5 && p.ponude.poslane.iznos === 60 + 250 + 70 + 80 + 90, 'poslane ponude u razdoblju (ponuda od 23. 11. je izvan jer je taj tjedan nepotpun)');
ok(p.ponude.prihvacene.n === 3 && p.ponude.prihvacene.iznos === 60 + 250 + 80, 'prihvaćene (uključuje račun i djelomično plaćeno)');
ok(p.ponude.placene.n === 1 && p.ponude.poStanju.odbijena?.n === 1, 'plaćene i odbijene po stanju');
ok(p.upitiUPonudu === 14, 'iz upita u ponudu: 5 od 36');
ok(p.niz.length === 4 && p.niz[0].od === '2026-10-26' && p.niz[3].upiti === 11, 'niz po tjednima za graf');
ok(p.prethodno === null, 'prethodna 4 tjedna počinju prije prvog upisanog tjedna: nema usporedbe, ne uspoređuje se s pola podataka');
p = await pregledProdaje(E, 't1', sada, { dana: '14' });
ok(p.razdoblje.od === '2026-11-09' && p.razdoblje.tjedana === 2 && p.upiti.n === 9 + 11, '14 dana: dva tjedna');
ok(p.prethodno && p.prethodno.od === '2026-10-26' && p.prethodno.do === '2026-11-08' && p.prethodno.upiti.n === 7 + 9 && p.prethodno.tjedana === 2, 'prethodno razdoblje iste duljine, oba tjedna upisana');
ok(p.prethodno.ponudeDostupne && p.prethodno.ponude.poslane.n === 2, 'prethodno: ponude dostupne (najranija ponuda je prije početka)');
p = await pregledProdaje(E, 't1', sada);
ok(p.doseg === null, 'bez Meta računa nema dosega');

// doseg iz dnevnih brojki samo kad pokrivaju cijelo razdoblje na svakom računu
db.prepare(`INSERT INTO racuni (id, tenant_id, mreza, naziv, status, kreirano) VALUES ('ig-a', 't1', 'instagram', '@a', 'spojeno', 'x'), ('fb-a', 't1', 'facebook', 'A', 'spojeno', 'x')`).run();
const ins = db.prepare(`INSERT INTO brojke_dan (tenant_id, racun_id, datum, mjera, vrijednost) VALUES ('t1', ?, ?, 'doseg', ?)`);
for (let i = 0; i < 28; i++) { const d = new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10); ins.run('ig-a', d, 100); if (i < 20) ins.run('fb-a', d, 10); }
p = await pregledProdaje(E, 't1', sada);
ok(p.doseg.pokriveno === 20 && p.doseg.vrijednost === null, 'doseg: račun s nepotpunim danima poništava zbroj');
for (let i = 20; i < 28; i++) ins.run('fb-a', new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10), 10);
p = await pregledProdaje(E, 't1', sada);
ok(p.doseg.vrijednost === 28 * 110 && p.doseg.zbrojDana, 'doseg: cijelo razdoblje pokriveno, zbroj dana');

p = await pregledProdaje(E, 't1', sada, { dana: '90' });
ok(p.razdoblje.tjedana === 6 && p.razdoblje.ocekivano === 12 && p.prethodno === null, '90 dana: uneseno 6 od 12 tjedana; prethodno izlazi iz upisanih podataka');
p = await pregledProdaje(E, 't1', sada, { od: '2026-11-02', do: '2026-11-22' });
ok(p.razdoblje.od === '2026-11-02' && p.razdoblje.tjedana === 3 && p.upiti.n === 9 + 9 + 11 && p.prethodno.upiti.n === 4 + 6 + 7, 'prilagođeno: 3 cijela tjedna, prethodna 3 tjedna');
p = await pregledProdaje(E, 't1', sada, { od: '2026-11-04', do: '2026-11-20' });
ok(p.razdoblje.ocekivano === 1 && p.razdoblje.od === '2026-11-09', 'prilagođeno koje ne počinje u ponedjeljak: zaokruženo na cijele tjedne');
p = await pregledProdaje({ DB: d1(db) }, 't2', sada);
ok(p.upiti.n === 0 && p.ponude.poslane.n === 0 && p.prethodno === null, 'drugi zakupac ne vidi tuđe podatke');
await pregledProdaje(E, 't1', sada, { dana: '2' }).then(() => ok(false, 'neispravan upit'), (e) => ok(/7 do 366/.test(e.message), 'neispravan upit iz API-ja'));
console.log(pali ? `\n${pali} provjera nije prošlo` : '\nSve provjere su prošle');
