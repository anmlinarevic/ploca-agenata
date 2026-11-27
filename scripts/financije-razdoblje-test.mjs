// Financije po razdoblju: zadnjih N mjeseci ili od-do, usporedba s prethodnim razdobljem iste duljine, neispravan unos.
// Bez wranglera: prave migracije na SQLite bazi. Upotreba: node scripts/financije-razdoblje-test.mjs
import { d1, nova } from './d1-sqlite.mjs';
import { pregledFinancija, razdobljeFinancija } from '../packages/poslovanje/financije.js';

let pali = 0;
const ok = (c, m) => { if (!c) { console.error('PAO:', m); pali++; process.exitCode = 1; } else console.log('ok  ', m); };
const baca = (f, re, m) => { try { f(); ok(false, `${m} (nije bacilo grešku)`); } catch (e) { ok(re.test(e.message), `${m} (${e.message})`); } };

const sada = new Date('2026-11-25T10:00:00Z');
const danas = '2026-11-25';

// ---- razdoblje iz upita ----
let r = razdobljeFinancija({}, danas);
ok(r.od === '2026-06' && r.do === '2026-11' && r.n === 6, 'bez upita: zadnjih 6 mjeseci, kao prije');
r = razdobljeFinancija({ mjeseci: '3' }, danas); ok(r.od === '2026-09' && r.n === 3, 'zadnja 3 mjeseca');
r = razdobljeFinancija({ mjeseci: '12' }, danas); ok(r.od === '2025-12' && r.do === '2026-11' && r.n === 12, 'godina dana prelazi granicu godine');
r = razdobljeFinancija({ od: '2026-03', do: '2026-05' }, danas); ok(r.od === '2026-03' && r.do === '2026-05' && r.n === 3, 'prilagođeno od-do');
r = razdobljeFinancija({ od: '2026-03' }, danas); ok(r.do === '2026-11' && r.n === 9, 'samo početak: do tekućeg mjeseca');
baca(() => razdobljeFinancija({ od: '2026-05', do: '2026-03' }, danas), /prije kraja/, 'početak nakon kraja');
baca(() => razdobljeFinancija({ od: '2026-03', do: '2026-12' }, danas), /budućnosti/, 'kraj u budućnosti');
baca(() => razdobljeFinancija({ od: '2026-3', do: '2026-05' }, danas), /YYYY-MM/, 'neispravan oblik mjeseca');
baca(() => razdobljeFinancija({ od: '2020-01', do: '2026-05' }, danas), /najviše 24/, 'predugo razdoblje');
baca(() => razdobljeFinancija({ mjeseci: '0' }, danas), /1 do 24/, 'nula mjeseci');
baca(() => razdobljeFinancija({ mjeseci: 'abc' }, danas), /1 do 24/, 'mjeseci nisu broj');

// ---- izračun nad bazom ----
const db = nova();
const E = { DB: d1(db) };
// ponude: [id, status, iznos, isporuka_od, usluga (naziv stavke), racuni, placeno, za_platiti]
const ponude = [
  [1, 'Accepted', 100, '2026-01-10', 'Banner s imenom', 1, 100, 100],
  [2, 'Accepted', 200, '2026-04-15', 'Soft play igraonica', 1, 200, 200],
  [3, 'Accepted', 60, '2026-08-20', 'Banner s imenom', 1, 60, 60],
  [4, 'Accepted', 300, '2026-09-05', 'Soft play igraonica', 1, 150, 300],
  [5, 'Accepted', 90, '2026-10-12', 'Banner s imenom', 1, 90, 90],
  [6, 'Accepted', 120, '2026-11-03', 'Banner s imenom', 0, null, null],
  [7, 'Issued', 999, '2026-11-15', 'Banner s imenom', 0, null, null],
  [8, 'Accepted', 80, '2026-06-02', 'Banner s imenom', 1, 80, 80],
];
for (const [id, st, iznos, isp, naziv, racun, placeno, zaPlatiti] of ponude)
  db.prepare(`INSERT INTO parra_ponude (tenant_id, id, broj, status, datum_ponude, isporuka_od, isporuka_do, iznos, valuta, stavke_json, racuni_json, placeno, za_platiti, sinkronizirano)
    VALUES ('t1', ?, ?, ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, '2026-11-25T00:00:00Z')`)
    .run(id, `${id}-1-1`, st, isp, isp, isp, iznos, JSON.stringify([{ naziv, kolicina: 1, jedinica: 'kom' }]), JSON.stringify(racun ? [{ id: 100 + id, broj: 'R', status: 'Issued' }] : []), placeno, zaPlatiti);
db.prepare(`INSERT INTO pokretanja (id, tenant_id, agent, kreirano, trosak_usd) VALUES ('p1', 't1', 'seo', '2026-11-10T10:00:00Z', 1.5), ('p2', 't1', 'seo', '2026-09-10T10:00:00Z', 2.25)`).run();

let f = await pregledFinancija(E, 't1', sada);
ok(f.mjeseci.length === 6 && f.ovaj.mjesec === '2026-11' && f.ovaj.prihod === 120, 'zadano: 6 mjeseci, studeni 120 € (poslana ponuda se ne računa)');
ok(f.razdoblje.n === 6 && f.razdoblje.prihod === 80 + 60 + 300 + 90 + 120, `razdoblje 6 mjeseci: prihod ${f.razdoblje.prihod}`);

f = await pregledFinancija(E, 't1', sada, { mjeseci: '3' });
ok(f.mjeseci.map((m) => m.mjesec).join() === '2026-09,2026-10,2026-11' && f.razdoblje.prihod === 300 + 90 + 120, 'zadnja 3 mjeseca: rujan, listopad, studeni');
ok(f.razdoblje.naplaceno === 150 + 90 + 0 && f.razdoblje.igraonica === 300 && f.razdoblje.sivanje === 210, 'naplaćeno i podjela po usluzi u razdoblju');
ok(f.razdoblje.agenti === 3.75 && f.razdoblje.ponuda === 3, 'trošak agenata i broj ponuda u razdoblju');
ok(f.prethodno && f.prethodno.od === '2026-06' && f.prethodno.do === '2026-08' && f.prethodno.prihod === 80 + 60, `prethodno razdoblje (lip-kol): ${f.prethodno?.prihod}`);
ok(f.cekaUplatu === 150 && f.bezRacuna === 1 && f.bezRacunaIznos === 120, 'čeka uplatu i bez računa ne ovise o razdoblju');

f = await pregledFinancija(E, 't1', sada, { mjeseci: '12' });
ok(f.mjeseci.length === 12 && f.razdoblje.prihod === 100 + 200 + 60 + 300 + 90 + 120 + 80, 'godina dana: svih 12 mjeseci');
ok(f.prethodno === null && f.prviMjesec === '2026-01', 'prethodno razdoblje izlazi iz povijesti: nema usporedbe');

f = await pregledFinancija(E, 't1', sada, { od: '2026-01', do: '2026-04' });
ok(f.razdoblje.n === 4 && f.razdoblje.prihod === 300 && f.mjeseci[3].mjesec === '2026-04', 'prilagođeno od siječnja do travnja');
ok(f.prethodno === null, 'prilagođeno razdoblje bez prethodnog u povijesti');

f = await pregledFinancija({ DB: d1(db) }, 't2', sada, { mjeseci: '3' });
ok(f.razdoblje.prihod === 0 && f.prviMjesec === null && f.prethodno === null, 'drugi zakupac ne vidi tuđe ponude');
await pregledFinancija(E, 't1', sada, { od: 'x' }).then(() => ok(false, 'neispravan upit mora baciti'), (e) => ok(/YYYY-MM/.test(e.message), 'neispravan upit iz API-ja'));

console.log(pali ? `\n${pali} provjera nije prošlo` : '\nSve provjere su prošle');
