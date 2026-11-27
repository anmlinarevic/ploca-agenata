// Mreže po razdoblju: povlačenje dnevnih pregleda i dosega u komadima do godine dana, zbrojevi i usporedba, meki pad kad Meta metriku ne daje.
// Bez wranglera: prave migracije na SQLite bazi i lažna Meta. Upotreba: node scripts/meta-povijest-test.mjs
import { d1, nova } from './d1-sqlite.mjs';
import { laznaMeta, vrijednostDana } from './lazna-meta.mjs';
import { sinkronizirajMetu, pregledMreza, razdobljeMreza, danIzKrajaDana } from '../packages/poslovanje/meta.js';
import { dodajRacun, popisRacuna } from '../packages/poslovanje/racuni.js';

let pali = 0;
const ok = (c, m) => { if (!c) { console.error('PAO:', m); pali++; process.exitCode = 1; } else console.log('ok  ', m); };
const baca = (f, re, m) => { try { f(); ok(false, `${m} (nije bacilo grešku)`); } catch (e) { ok(re.test(e.message), `${m} (${e.message})`); } };

const sada = new Date('2026-11-25T10:00:00Z'), danas = '2026-11-25';
const dod = (iso, k) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const dan = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const raspon = (od, doD) => { const l = []; for (let d = od; d <= doD; d = dod(d, 1)) l.push(d); return l; };

ok(danIzKrajaDana('2026-11-26T08:00:00+0000') === '2026-11-25', 'end_time je kraj dana: 26. 11. u 08:00 znači 25. 11.');
let r = razdobljeMreza({}, danas); ok(r.dana === 28 && r.do === '2026-11-24', 'zadano 28 dana do jučer');
r = razdobljeMreza({ dana: '1' }, danas); ok(r.od === '2026-11-24' && r.do === '2026-11-24', '1 dan = jučer');
baca(() => razdobljeMreza({ od: '2026-11-01', do: '2026-11-25' }, danas), /najkasnije jučer/, 'kraj danas');
baca(() => razdobljeMreza({ dana: '400' }, danas), /1 do 366/, 'predugo');

const db = nova(); const m = laznaMeta();
const E = { DB: d1(db), META_TOKEN: 't', META_ZAKUPAC: 't1', META_STRANICA: '555111' };
const sync = () => sinkronizirajMetu(E, 't1', { fetchFn: m.fetchFn, sada: () => sada });

// ---- prvi krug: najnoviji prozor + dva starija (90 dana) ----
let s = await sync();
ok(s.ok, `prvi krug uspio${s.ok ? '' : ` (${s.greska})`}`);
let rac = await popisRacuna(E.DB, 't1');
const ig = rac.find((x) => x.mreza === 'instagram'), fb = rac.find((x) => x.mreza === 'facebook');
const brojDana = (id, mjera) => db.prepare(`SELECT COUNT(*) AS n, MIN(datum) AS od, MAX(datum) AS do FROM brojke_dan WHERE racun_id = ? AND mjera = ?`).get(id, mjera);
let c = brojDana(ig.id, 'pregledi');
ok(c.n === 90 && c.do === '2026-11-24' && c.od === dod('2026-11-24', -89), `Instagram: 90 dana pregleda (${c.od} do ${c.do})`);
ok(brojDana(ig.id, 'doseg').n === 90 && brojDana(fb.id, 'pregledi').n === 90 && brojDana(fb.id, 'doseg').n === 90, 'doseg i Facebook isto po 90 dana');
const tocan = db.prepare(`SELECT vrijednost FROM brojke_dan WHERE racun_id = ? AND mjera = 'pregledi' AND datum = '2026-11-20'`).get(ig.id).vrijednost;
ok(tocan === vrijednostDana('views', dan('2026-11-20'), 1), 'dan je pravilno pripisan (end_time minus dan), vrijednost točno za 20. 11.');
const red = db.prepare(`SELECT povijest_dnevno_od AS o, dnevno_greska AS g FROM racuni WHERE id = ?`).get(ig.id);
ok(red.o === '2026-08-27' && red.g === null, `kursor povijesti: ${red.o}`);

// ---- ostali krugovi dovlače povijest do godine dana ----
for (let i = 0; i < 5; i++) await sync();   // 90 dana u prvom krugu + po 60 u svakom idućem: za godinu treba šest krugova (oko 1,5 dana uz osvježavanje svakih 6 sati)
c = brojDana(ig.id, 'pregledi');
ok(c.n === 365 && c.od === dod(danas, -365), `nakon nekoliko krugova: 365 dana (${c.od} do ${c.do})`);
ok(db.prepare(`SELECT povijest_dnevno_od AS o FROM racuni WHERE id = ?`).get(ig.id).o === dod(danas, -365), 'kursor je na početku godine');
const prije = m.stanje.dnevnihZahtjeva;
await sync();
ok(m.stanje.dnevnihZahtjeva - prije === 4, `kad je povijest gotova, krug traži samo zadnjih 30 dana (${m.stanje.dnevnihZahtjeva - prije} zahtjeva za 2 računa × 2 metrike)`);
ok(brojDana(ig.id, 'pregledi').n === 365, 'ponovni krug ne duplicira dane');

// ---- pregled po razdoblju ----
const zbroj = (skala, metrika, od, doD) => raspon(od, doD).reduce((x, d) => x + vrijednostDana(metrika, dan(d), skala), 0);
let p = await pregledMreza(E, 't1', sada, { dana: '28' });
let pi = p.racuni.find((x) => x.id === ig.id).razdoblje;
const od28 = dod('2026-11-24', -27);
ok(pi.pregledi.vrijednost === zbroj(1, 'views', od28, '2026-11-24') && pi.pregledi.dana === 28 && pi.serija.length === 28, 'Instagram: pregledi za 28 dana iz dnevnih brojki');
ok(pi.doseg.vrijednost === zbroj(1, 'reach', od28, '2026-11-24'), 'doseg je zbroj dnevnog dosega');
const pret = zbroj(1, 'views', dod(od28, -28), dod(od28, -1));
ok(pi.pregledi.prethodno === pret && pi.pregledi.promjena === Math.round((pi.pregledi.vrijednost - pret) / pret * 100), 'usporedba s prethodnih 28 dana');
ok(p.razdoblje.od === od28 && p.razdoblje.do === '2026-11-24' && p.kanali.instagram.pratitelji === 1284, 'razdoblje u odgovoru, a stari oblik ostaje');
p = await pregledMreza(E, 't1', sada, { dana: '365' });
pi = p.racuni.find((x) => x.id === ig.id).razdoblje;
ok(pi.pregledi.dana === 365 && pi.serija.length === 365 && pi.pregledi.prethodno === null && pi.pregledi.promjena === null, 'godina dana: nema usporedbe jer prethodno razdoblje nije učitano');
p = await pregledMreza(E, 't1', sada, { dana: '1' });
pi = p.racuni.find((x) => x.id === ig.id).razdoblje;
ok(pi.pregledi.vrijednost === vrijednostDana('views', dan('2026-11-24'), 1) && pi.pregledi.prethodno === vrijednostDana('views', dan('2026-11-23'), 1), '1 dan = jučer, usporedba s prethodnim danom');
p = await pregledMreza(E, 't1', sada, { od: '2026-03-01', do: '2026-05-31' });
pi = p.racuni.find((x) => x.id === ig.id).razdoblje;
ok(pi.pregledi.vrijednost === zbroj(1, 'views', '2026-03-01', '2026-05-31') && pi.pregledi.dana === 92, 'prilagođeno od-do');
ok(pi.objaveBroj === 0 && pi.objaveDostupnoOd, 'objave u razdoblju se broje samo iz spremljenih, a ekran zna od kad ih ima');
p = await pregledMreza(E, 't1', sada);
ok(p.razdoblje === null && p.racuni[0].razdoblje === undefined, 'bez upita nema bloka razdoblja (stari ekran)');
await pregledMreza(E, 't1', sada, { dana: 'x' }).then(() => ok(false, 'neispravan upit'), (e) => ok(/1 do 366/.test(e.message), 'neispravan upit iz API-ja'));

// ---- Meta ne daje metriku kao dnevni niz: meki pad ----
const db2 = nova(); const m2 = laznaMeta(); m2.stanje.bezViewsDnevno = true;
const E2 = { DB: d1(db2), META_TOKEN: 't', META_ZAKUPAC: 't1', META_STRANICA: '555111' };
s = await sinkronizirajMetu(E2, 't1', { fetchFn: m2.fetchFn, sada: () => sada });
const ig2 = (await popisRacuna(E2.DB, 't1')).find((x) => x.mreza === 'instagram');
ok(s.ok && s.upozorenja.some((u) => /Dnevne brojke \(instagram\)/.test(u) && /views/.test(u)), 'krug uspijeva, upozorenje kaže da Meta ne daje dnevne preglede');
const red2 = db2.prepare(`SELECT dnevno_greska AS g FROM racuni WHERE id = ?`).get(ig2.id);
ok(/views/.test(red2.g), 'račun pamti zašto nema dnevnih pregleda');
ok(db2.prepare(`SELECT COUNT(*) AS n FROM brojke_dan WHERE racun_id = ? AND mjera = 'doseg'`).get(ig2.id).n === 30 && db2.prepare(`SELECT COUNT(*) AS n FROM brojke_dan WHERE racun_id = ? AND mjera = 'pregledi'`).get(ig2.id).n === 0, 'doseg se učitava (30 dana), a pregledi ne; starije se ne traži uzalud');
const p2 = await pregledMreza(E2, 't1', sada, { dana: '28' });
const pi2 = p2.racuni.find((x) => x.id === ig2.id).razdoblje;
ok(pi2.pregledi.vrijednost === null && pi2.doseg.vrijednost !== null && /views/.test(pi2.dnevnoGreska), 'ekran dobiva doseg, a za preglede razlog zašto ih nema');
console.log(pali ? `\n${pali} provjera nije prošlo` : '\nSve provjere su prošle');
