// Objave po računu: odabir računa, više računa na istoj mreži, povezane objave (grupa), migracija 0012, alat dohvati_racune.
// Bez wranglera: prave migracije na SQLite bazi i MCP alati pozvani izravno (lažni R2). Upotreba: node scripts/objave-racuni-test.mjs
import { d1, primijeni, nova } from './d1-sqlite.mjs';
import { OBJAVE } from '../apps/mcp/src/alati-objave.js';
import { dodajRacun, ukloniRacun, odrediRacunObjave } from '../packages/poslovanje/racuni.js';
import { koristenjeMaterijala } from '../packages/poslovanje/objave.js';

let pali = 0;
const ok = (c, m) => { if (!c) { console.error('PAO:', m); pali++; process.exitCode = 1; } else console.log('ok  ', m); };
const baca = async (f, re, m) => { try { await f(); ok(false, `${m} (nije bacilo grešku)`); } catch (e) { ok(re.test(e.message), `${m} (${e.message})`); } };
const alat = (ime) => OBJAVE.find((x) => x.name === ime);

// ---- migracija 0012 na bazi sa starim objavama ----
{
  const db = nova(11);
  db.exec(`INSERT INTO racuni (id, tenant_id, mreza, naziv, status, kreirano) VALUES ('tt-1', 't1', 'tiktok', '@piccolini.play', 'rucno', 'x'), ('ig-1', 't1', 'instagram', '@a', 'spojeno', 'x'), ('ig-2', 't1', 'instagram', '@b', 'spojeno', 'x');
    INSERT INTO objave (id, tenant_id, kanal, vrsta, naslov, opis, kreirano, azurirano) VALUES ('o1', 't1', 'tiktok', 'video', 'T', 'o', 'x', 'x'), ('o2', 't1', 'instagram', 'video', 'I', 'o', 'x', 'x'), ('o3', 't1', 'facebook', 'video', 'F', 'o', 'x', 'x');`);
  primijeni(db, 99, 12);
  const r = Object.fromEntries(db.prepare(`SELECT id, racun_id FROM objave`).all().map((x) => [x.id, x.racun_id]));
  ok(r.o1 === 'tt-1', 'migracija: objava na mreži s jednim računom prelazi na njega');
  ok(r.o2 === null, 'migracija: objava na mreži s dva računa ostaje bez računa (ne pogađa se)');
  ok(r.o3 === null, 'migracija: mreža bez računa ostaje bez računa');
}

// ---- alati ----
const db = nova();
const E = { DB: d1(db), MEDIJI: { head: async () => ({ httpMetadata: { contentType: 'video/mp4' }, size: 1234 }) } };
const ctx = { tenantId: 't1', agent: 'kreator', origin: 'http://x' };
const objava = (extra = {}) => ({ serija: 'imena', vrsta: 'video', naslov: 'Što znači ime Lucija?', opis: 'Opis #imena', mediji: ['t1/objave/2026-11/a.mp4'], ...extra });
const racuni = async (m) => (await alat('dohvati_racune').run({ mreza: m }, ctx, E)).racuni;

ok((await racuni()).length === 0, 'dohvati_racune: prazan popis dok nema računa');
let o = await alat('predlozi_objavu').run(objava(), ctx, E);
ok(o.racun_id === null, 'mreža bez dodanog računa: objava radi kao prije, bez računa');

const tt = (await dodajRacun(E.DB, 't1', { mreza: 'tiktok', naziv: '@piccolini.play' }))[0];
o = await alat('predlozi_objavu').run(objava(), ctx, E);
ok(o.racun_id === tt.id, 'jedan račun na mreži: objava ide na njega bez navođenja');

const igA = (await dodajRacun(E.DB, 't1', { mreza: 'instagram', id_stranice: '555111', naziv: '@piccoliniplay', usluga: 'oboje' })).find((x) => x.mreza === 'instagram');
const igB = (await dodajRacun(E.DB, 't1', { mreza: 'instagram', id_stranice: '556222', naziv: '@piccolini.sivanje', usluga: 'banneri' })).find((x) => x.mreza === 'instagram');
await baca(() => alat('predlozi_objavu').run(objava({ kanal: 'instagram' }), ctx, E), /ima 2 računa.*@piccolini\.sivanje.*Navedi racun_id/, 'dva računa na mreži: račun se mora navesti');
o = await alat('predlozi_objavu').run(objava({ kanal: 'instagram', racun_id: igB.id, grupa_id: 'lucija' }), ctx, E);
ok(o.racun_id === igB.id, 'objava na izabrani Instagram račun');
await baca(() => alat('predlozi_objavu').run(objava({ kanal: 'tiktok', racun_id: igB.id }), ctx, E), /je instagram račun, a objava je za tiktok/, 'račun druge mreže se odbija');
await baca(() => alat('predlozi_objavu').run(objava({ kanal: 'instagram', racun_id: 'ne-postoji' }), ctx, E), /ne postoji ili je uklonjen/, 'nepostojeći račun');
await baca(() => alat('predlozi_objavu').run(objava({ kanal: 'instagram', racun_id: igA.id, grupa_id: 'ne smije razmak' }), ctx, E), /grupa_id/, 'neispravan grupa_id');
await baca(() => odrediRacunObjave(E.DB, 't2', 'instagram', igA.id), /ne postoji ili je uklonjen/, 'račun drugog zakupca se ne može koristiti');

// ista ideja na dva računa: dvije objave, svaka sa svojim statusom
const o2 = await alat('predlozi_objavu').run(objava({ kanal: 'instagram', racun_id: igA.id, grupa_id: 'lucija', opis: 'Drugi opis za @piccoliniplay' }), ctx, E);
const doc = (await alat('dohvati_objave').run({}, ctx, E)).objave;
const iste = doc.filter((x) => x.grupaId === 'lucija');
ok(iste.length === 2 && new Set(iste.map((x) => x.racunId)).size === 2 && iste.every((x) => x.status === 'ceka'), 'ista ideja na dva računa: dvije povezane objave (grupa)');
ok(iste.find((x) => x.racunId === igA.id).opis !== iste.find((x) => x.racunId === igB.id).opis, 'svaka objava ima vlastiti opis');
ok(doc.every((x) => 'racunId' in x && 'grupaId' in x), 'dokument objave nosi racunId i grupaId');
db.prepare(`UPDATE objave SET status = 'odobreno' WHERE id = ?`).run(o2.id);
const nakon = (await alat('dohvati_objave').run({}, ctx, E)).objave.filter((x) => x.grupaId === 'lucija');
ok(nakon.find((x) => x.id === o2.id).status === 'odobreno' && nakon.find((x) => x.id !== o2.id).status === 'ceka', 'jedan račun se može odobriti, drugi ostaje na čekanju');

// ažuriranje
await alat('azuriraj_objavu').run({ id: o.id, opis: 'Novi opis' }, ctx, E);
ok((await alat('dohvati_objave').run({}, ctx, E)).objave.find((x) => x.id === o.id).racunId === igB.id, 'ispravak opisa ne mijenja račun');
await baca(() => alat('azuriraj_objavu').run({ id: o.id, kanal: 'facebook' }, ctx, E), /Na mreži facebook ima 2 računa/, 'promjena kanala na mrežu s dva računa traži izbor računa');
const a2 = await alat('azuriraj_objavu').run({ id: o.id, racun_id: igA.id }, ctx, E);
ok(a2.izmjena === 3 && (await alat('dohvati_objave').run({}, ctx, E)).objave.find((x) => x.id === o.id).racunId === igA.id, 'objava se može prebaciti na drugi račun iste mreže');

// uklonjen račun
await ukloniRacun(E.DB, 't1', igA.id);
await baca(() => alat('predlozi_objavu').run(objava({ kanal: 'instagram', racun_id: igA.id }), ctx, E), /uklonjen/, 'uklonjeni račun više ne prima objave');
ok(!(await racuni('instagram')).some((x) => x.id === igA.id) && (await racuni('instagram')).length === 1, 'dohvati_racune ne vraća uklonjene');
o = await alat('predlozi_objavu').run(objava({ kanal: 'instagram' }), ctx, E);
ok(o.racun_id === igB.id, 'nakon uklanjanja ostaje jedan račun pa se uzima bez navođenja');
// ---- korištenje materijala iz knjižnice po računima ----
db.prepare(`INSERT INTO knjiznica (id, tenant_id, kljuc, vrsta, mime, velicina, usluga, slobodno, kreirano) VALUES ('m1', 't1', 't1/knjiznica/a.jpg', 'foto', 'image/jpeg', 10, 'oboje', 1, 'x'), ('m2', 't1', 't1/knjiznica/b.jpg', 'foto', 'image/jpeg', 10, 'oboje', 1, 'x')`).run();
const kor1 = await alat('predlozi_objavu').run(objava({ kanal: 'instagram', racun_id: igB.id, knjiznica: ['m1'] }), ctx, E);
await alat('predlozi_objavu').run(objava({ kanal: 'instagram', racun_id: igB.id, knjiznica: ['m1', 'm2'] }), ctx, E);
await alat('predlozi_objavu').run(objava({ kanal: 'tiktok', knjiznica: ['m1'] }), ctx, E);
const odbacena = await alat('predlozi_objavu').run(objava({ kanal: 'instagram', racun_id: igB.id, knjiznica: ['m2'] }), ctx, E);
db.prepare(`UPDATE objave SET status = 'odbaceno' WHERE id = ?`).run(odbacena.id);
const kor = await koristenjeMaterijala(E.DB, 't1');
ok(kor.m1.find((x) => x.racunId === igB.id).n === 2 && kor.m1.find((x) => x.racunId === tt.id).n === 1, 'korištenje materijala: broj objava po računu');
ok(kor.m2.length === 1 && kor.m2[0].n === 1, 'odbačena objava se ne broji kao korištenje');
ok(Object.keys(await koristenjeMaterijala(E.DB, 't2')).length === 0, 'drugi zakupac ne vidi tuđe korištenje');
void kor1;
await baca(() => alat('dohvati_racune').run({ mreza: 'twitter' }, ctx, E), /mreza:/, 'dohvati_racune: nepoznata mreža');
console.log(pali ? `\n${pali} provjera nije prošlo` : '\nSve provjere su prošle');
