// Računi na mrežama: migracija 0011 sa starih podataka, više računa po mreži, izolacija grešaka, uklanjanje računa.
// Bez wranglera i bez uvoza stare ploče: prave migracije na SQLite bazi (node:sqlite) iza malog D1 adaptera i lažni Meta fetch.
// Upotreba: node scripts/racuni-test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { sinkronizirajMetu, pregledMreza, metaPodesena } from '../packages/poslovanje/meta.js';
import { dodajRacun, popisRacuna, ukloniRacun, provjeriRacun } from '../packages/poslovanje/racuni.js';

let pali = 0;
const ok = (c, m) => { if (!c) { console.error('PAO:', m); pali++; process.exitCode = 1; } else console.log('ok  ', m); };
const baca = async (f, re, m) => { try { await f(); ok(false, `${m} (nije bacilo grešku)`); } catch (e) { ok(re.test(e.message), `${m} (${e.message})`); } };

/** Najmanji D1 adapter za ovaj test: prepare/bind/run/all/first i batch u transakciji. */
function d1(db) {
  const st = (sql) => {
    let a = [];
    const o = {
      bind(...x) { a = x; return o; },
      run() { const r = db.prepare(sql).run(...a); return Promise.resolve({ success: true, meta: { changes: Number(r.changes) } }); },
      all() { return Promise.resolve({ results: db.prepare(sql).all(...a) }); },
      first() { return Promise.resolve(db.prepare(sql).get(...a) ?? null); },
      _sync() { return db.prepare(sql).run(...a); },
    };
    return o;
  };
  return {
    prepare: st,
    async batch(lista) {
      db.exec('BEGIN');
      try { lista.forEach((s) => s._sync()); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return lista.map(() => ({ success: true }));
    },
  };
}
const migracije = readdirSync('packages/db/migrations').filter((f) => f.endsWith('.sql')).sort();
const primijeni = (db, do_ = 99, od = 1) => migracije.filter((f) => +f.slice(0, 4) <= do_ && +f.slice(0, 4) >= od).forEach((f) => db.exec(readFileSync(`packages/db/migrations/${f}`, 'utf8')));
const nova = (do_) => { const db = new DatabaseSync(':memory:'); primijeni(db, do_); db.exec(`INSERT INTO tenants (id, naziv) VALUES ('t1', 'Test'), ('t2', 'Drugi')`); return db; };

/** Lažna Meta (Graph API) s dvije stranice i dva Instagram računa. */
function laznaMeta() {
  const stranice = {
    555111: { ime: 'Piccolini Play', fol: 842, igId: '777', igIme: 'piccoliniplay', igFol: 1284, token: 'str-555', skala: 1 },
    556222: { ime: 'Piccolini Šivanje', fol: 310, igId: '778', igIme: 'piccolini.sivanje', igFol: 1912, token: 'str-556', skala: 2 },
  };
  const stanje = { istekao: false, nepostojeca: new Set() };
  const kad = (dana) => new Date(Date.now() - dana * 86400000).toISOString().replace('.000Z', '+0000');
  const odg = (status, tijelo) => ({ ok: status < 400, status, json: async () => tijelo });
  const greska = (status, code, message) => odg(status, { error: { message, code } });
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url), put = u.pathname.replace(/^\/v25\.0\//, ''), auth = opts.headers?.authorization;
    const metrike = (u.searchParams.get('metric') || '').split(',').filter(Boolean);
    if (stanje.istekao) return greska(400, 190, 'Error validating access token: Session has expired.');
    const str = stranice[put] || Object.values(stranice).find((s) => put.startsWith(`${Object.keys(stranice).find((k) => stranice[k] === s)}/`));
    if (stanje.nepostojeca.has(put)) return greska(400, 803, "(#803) Some of the aliases you requested do not exist");
    if (stranice[put]) {
      const s = stranice[put];
      return odg(200, { name: s.ime, followers_count: s.fol, access_token: s.token, instagram_business_account: { id: s.igId, username: s.igIme, followers_count: s.igFol } });
    }
    const ig = Object.values(stranice).find((s) => put.startsWith(`${s.igId}/`));
    if (ig) {
      if (put.endsWith('/insights')) { const v = { reach: 1000 * ig.skala, views: 2000 * ig.skala, total_interactions: 50, saves: 5, shares: 2 };
        return odg(200, { data: metrike.map((m) => ({ name: m, period: 'day', total_value: { value: v[m] ?? 0 } })) }); }
      if (put.endsWith('/media')) return odg(200, { data: [0, 1, 2].map((i) => ({ id: `${ig.igId}${i}`, caption: `Objava ${ig.igIme} ${i}`, media_type: i === 0 ? 'VIDEO' : 'IMAGE', media_product_type: i === 0 ? 'REELS' : 'FEED', timestamp: kad(3 + i * 10), permalink: `https://instagram.com/p/${ig.igId}${i}`, like_count: 10, comments_count: 1 })) });
    }
    const sIg = Object.values(stranice).find((s) => /^\d+\/insights$/.test(put) && put.startsWith(`${s.igId}`));
    if (str) {
      const s = stranice[Object.keys(stranice).find((k) => put.startsWith(`${k}/`))];
      if (auth !== `Bearer ${s.token}`) return greska(400, 190, '(#190) This method must be called with a Page Access Token');
      if (put.endsWith('/insights')) return odg(200, { data: [{ name: 'page_media_view', values: [{ value: 400 * s.skala }, { value: 700 * s.skala }] }, { name: 'page_total_media_view_unique', values: [{ value: 300 * s.skala }, { value: 500 * s.skala }] }] });
      if (put.endsWith('/posts')) return odg(200, { data: [0, 1].map((i) => ({ id: `${Object.keys(stranice).find((k) => stranice[k] === s)}_9${i}`, message: `FB ${s.ime} ${i}`, created_time: kad(5 + i * 12), status_type: 'added_photos', permalink_url: 'https://facebook.com/x' })) });
    }
    let m;
    if ((m = /^(\w+)\/insights$/.exec(put))) {
      const fbStr = m[1].includes('_') ? stranice[m[1].split('_')[0]] : null;
      if (fbStr) { if (auth !== `Bearer ${fbStr.token}`) return greska(400, 190, '(#190) Page Access Token'); return odg(200, { data: [{ name: 'post_media_view', values: [{ value: 300 }] }, { name: 'post_total_media_view_unique', values: [{ value: 200 }] }, { name: 'post_clicks', values: [{ value: 9 }] }, { name: 'post_reactions_by_type_total', values: [{ value: { like: 7 } }] }] }); }
      const igS = Object.values(stranice).find((s) => m[1].startsWith(s.igId));
      if (igS) return odg(200, { data: [{ name: 'views', values: [{ value: 900 * igS.skala }] }, { name: 'reach', values: [{ value: 700 * igS.skala }] }, { name: 'saved', values: [{ value: 6 }] }, { name: 'shares', values: [{ value: 2 }] }] });
    }
    void sIg;
    return greska(400, 100, `Unsupported get request ${put}`);
  };
  return { fetchFn, stanje };
}

const env = (db, extra = {}) => ({ DB: d1(db), META_TOKEN: 'test-meta', META_ZAKUPAC: 't1', ...extra });

// ============ 1) migracija sa starih podataka ============
{
  const db = nova(10);
  db.exec(`INSERT INTO meta_sinkronizacija (tenant_id, ig_korisnik, ig_ime, stranica_ime, zadnje, zadnje_uspjesno, greska, upozorenja_json) VALUES ('t1', '777', 'piccoliniplay', 'Piccolini Play', '2026-11-20T06:00:00Z', '2026-11-20T06:00:00Z', NULL, '["upozorenje"]');
    INSERT INTO meta_pratitelji VALUES ('t1', 'instagram', '2026-11-19', 1270), ('t1', 'instagram', '2026-11-20', 1284), ('t1', 'facebook', '2026-11-20', 842);
    INSERT INTO meta_razdoblje VALUES ('t1', 'instagram', 'zadnjih', '2026-10-23', '2026-11-20', 14200, 26400, 910, 68, 35, '2026-11-20T06:00:00Z');
    INSERT INTO meta_objave (tenant_id, kanal, id, vrsta, objavljeno, opis, pregledi) VALUES ('t1', 'instagram', 'ig1', 'reel', '2026-11-10T10:00:00Z', 'Reel', 2300), ('t1', 'facebook', 'fb1', 'slika', '2026-11-12T10:00:00Z', 'FB', 400);`);
  primijeni(db, 99, 11); // ostatak (0011)
  const rac = db.prepare(`SELECT id, mreza, naziv, vanjski_id, stranica_id, status, povijest_od FROM racuni ORDER BY id`).all();
  ok(rac.length === 2 && rac[0].id === 'facebook-1' && rac[0].naziv === 'Piccolini Play' && rac[1].id === 'instagram-1' && rac[1].naziv === '@piccoliniplay' && rac[1].vanjski_id === '777', 'migracija: dosadašnja stranica i Instagram postaju računi');
  ok(rac.every((r) => r.status === 'spojeno' && r.stranica_id === null), 'migracija: status prenesen, id stranice čeka prvo osvježavanje');
  const o = db.prepare(`SELECT racun_id, id FROM meta_objave ORDER BY id`).all();
  ok(o.length === 2 && o[0].racun_id === 'facebook-1' && o[1].racun_id === 'instagram-1', 'migracija: objave prelaze na račune po kanalu');
  const b = db.prepare(`SELECT racun_id, datum, vrijednost FROM brojke_dan WHERE mjera = 'pratitelji' ORDER BY racun_id, datum`).all();
  ok(b.length === 3 && b.some((x) => x.racun_id === 'instagram-1' && x.datum === '2026-11-19' && x.vrijednost === 1270), 'migracija: pratitelji po danu prelaze u brojke po danu');
  ok(db.prepare(`SELECT povijest_od FROM racuni WHERE id = 'instagram-1'`).get().povijest_od === '2026-11-19', 'migracija: povijest računa počinje prvim danom s brojkama');
  ok(db.prepare(`SELECT racun_id FROM meta_razdoblje`).get().racun_id === 'instagram-1', 'migracija: zbrojevi za 28 dana prelaze na račun');
  // migracija bez ikakvih Meta podataka ne smije puknuti
  const prazna = nova(99); ok(prazna.prepare(`SELECT COUNT(*) AS n FROM racuni`).get().n === 0, 'migracija na praznoj bazi: nema računa');
}

// ============ 2) prijelaz sa tajne META_STRANICA ============
const db = nova();
const meta = laznaMeta();
const E = env(db, { META_STRANICA: '555111' });
ok(metaPodesena(E, 't1') && !metaPodesena(E, 't2'), 'Meta je spojena samo za svog zakupca (postoji token)');
let r = await sinkronizirajMetu(E, 't1', { fetchFn: meta.fetchFn });
ok(r.ok && r.objava === 5 && r.uvida === 5, `prvi krug iz tajne: ${r.objava} objava, ${r.uvida} uvida` + (r.ok ? '' : ` (${r.greska})`));
let rac = await popisRacuna(E.DB, 't1');
ok(rac.length === 2 && rac.every((x) => x.status === 'spojeno' && x.stranicaId === '555111'), 'stranica iz tajne postala je Facebook račun, a Instagram je pronađen sam');
const ig1 = rac.find((x) => x.mreza === 'instagram');
ok(ig1.naziv === '@piccoliniplay' && ig1.vanjskiId === '777' && ig1.povijestOd, 'Instagram račun dobiva naziv, id i početak povijesti');
let p = await pregledMreza(E, 't1');
ok(p.kanali.instagram.pratitelji === 1284 && p.kanali.facebook.pratitelji === 842 && p.meta.igIme === 'piccoliniplay' && p.meta.stranicaIme === 'Piccolini Play', 'stari oblik odgovora (kanali, meta) i dalje radi');
ok(p.kanali.instagram.doseg28 === 1000 && p.kanali.facebook.pregledi28 === 700, 'zbrojevi za 28 dana po računu');

// ============ 3) dva računa na istoj mreži ============
await baca(() => provjeriRacun({ mreza: 'instagram', id_stranice: '12ab' }), /samo brojke/, 'neispravan ID stranice');
await baca(() => provjeriRacun({ mreza: 'tiktok' }), /naziv/i, 'TikTok traži naziv');
await baca(() => provjeriRacun({ mreza: 'twitter' }), /mreza mora biti/, 'nepoznata mreža');
await baca(() => provjeriRacun({ mreza: 'facebook', id_stranice: '556222', usluga: 'sve' }), /usluga mora biti/, 'nepoznata usluga');
await baca(() => provjeriRacun({ mreza: 'facebook', id_stranice: '556222', naziv: 'ana@primjer.hr' }), /bez e-maila/, 'naziv bez e-maila');
const dod = await dodajRacun(E.DB, 't1', { mreza: 'instagram', id_stranice: '556222', naziv: '@piccolini.sivanje', usluga: 'banneri' });
ok(dod.length === 2 && dod.some((x) => x.mreza === 'instagram') && dod.some((x) => x.mreza === 'facebook'), 'Instagram račun dodaje i svoju Facebook stranicu');
await baca(() => dodajRacun(E.DB, 't1', { mreza: 'instagram', id_stranice: '556222' }), /već dodan/, 'isti Instagram račun dvaput');
await baca(() => dodajRacun(E.DB, 't1', { mreza: 'facebook', id_stranice: '556222' }), /već dodan/, 'ista Facebook stranica dvaput');
r = await sinkronizirajMetu(E, 't1', { fetchFn: meta.fetchFn });
ok(r.ok && r.objava === 10, `drugi krug čita obje stranice (${r.objava} objava)` + (r.ok ? '' : ` (${r.greska})`));
rac = await popisRacuna(E.DB, 't1');
const iga = rac.find((x) => x.mreza === 'instagram' && x.naziv === '@piccoliniplay'), igb = rac.find((x) => x.mreza === 'instagram' && x.naziv === '@piccolini.sivanje');
ok(rac.length === 4 && iga && igb && igb.vanjskiId === '778' && igb.usluga === 'banneri', 'dva Instagram računa, naziv koji je upisao čovjek se ne prepisuje');
ok(rac.find((x) => x.mreza === 'facebook' && x.stranicaId === '556222').naziv === 'Piccolini Šivanje', 'naziv Facebook stranice dolazi od Mete kad ga nitko nije upisao');
p = await pregledMreza(E, 't1');
const pa = p.racuni.find((x) => x.id === iga.id), pb = p.racuni.find((x) => x.id === igb.id);
ok(pa.podaci.pratitelji === 1284 && pb.podaci.pratitelji === 1912, 'pratitelji se ne miješaju među Instagram računima');
ok(pa.podaci.doseg28 === 1000 && pb.podaci.doseg28 === 2000, 'doseg za 28 dana po računu');
ok(pa.podaci.ukupnoObjava === 3 && pb.podaci.ukupnoObjava === 3 && pa.podaci.objave.every((o) => /piccoliniplay/.test(o.opis)) && pb.podaci.objave.every((o) => /sivanje/.test(o.opis)), 'objave pripadaju svaka svom računu');
ok(p.racuni.length === 4 && p.kanali.instagram.pratitelji != null, 'popis računa u odgovoru, uz stari oblik');
ok(db.prepare(`SELECT COUNT(*) AS n FROM brojke_dan WHERE mjera = 'pratitelji'`).get().n === 4, 'dnevne brojke upisane po računu');

// ============ 4) izolacija grešaka ============
meta.stanje.nepostojeca.add('556222');
r = await sinkronizirajMetu(E, 't1', { fetchFn: meta.fetchFn });
ok(!r.ok && /ne nalazi/.test(r.greska), `stranica koju Meta ne nalazi: jasna poruka (${r.greska})`);
rac = await popisRacuna(E.DB, 't1');
ok(rac.filter((x) => x.stranicaId === '556222').every((x) => x.status === 'greska' && /ne nalazi/.test(x.greska)), 'greška se zapisuje samo na račune te stranice');
ok(rac.filter((x) => x.stranicaId === '555111').every((x) => x.status === 'spojeno' && !x.greska), 'druga stranica radi dalje');
p = await pregledMreza(E, 't1');
ok(p.racuni.find((x) => x.id === igb.id).podaci.pratitelji === 1912 && /ne nalazi/.test(p.meta.greska), 'stari podaci računa s greškom ostaju vidljivi');
meta.stanje.nepostojeca.clear();
r = await sinkronizirajMetu(E, 't1', { fetchFn: meta.fetchFn, racunId: igb.id });
ok(r.ok && (await popisRacuna(E.DB, 't1')).find((x) => x.id === igb.id).status === 'spojeno', 'osvježavanje jednog računa vraća ga u red');

// istekao token zaustavlja cijeli krug (isti token vrijedi za sve stranice)
meta.stanje.istekao = true;
r = await sinkronizirajMetu(E, 't1', { fetchFn: meta.fetchFn });
ok(!r.ok && /token/i.test(r.greska) && r.zahtjeva === 1, `istekao token: jedan zahtjev, jasna poruka (${r.zahtjeva})`);
meta.stanje.istekao = false;

// ============ 5) uklanjanje računa ============
ok(await ukloniRacun(E.DB, 't1', igb.id) && !(await ukloniRacun(E.DB, 't1', igb.id)), 'račun se uklanja jednom');
ok(!(await ukloniRacun(E.DB, 't2', iga.id)), 'račun drugog zakupca se ne može ukloniti');
rac = await popisRacuna(E.DB, 't1');
ok(rac.length === 3 && !rac.some((x) => x.id === igb.id), 'uklonjeni račun nestaje s popisa');
ok(db.prepare(`SELECT COUNT(*) AS n FROM meta_objave WHERE racun_id = ?`).get(igb.id).n === 3, 'podaci uklonjenog računa ostaju u bazi');
r = await sinkronizirajMetu(E, 't1', { fetchFn: meta.fetchFn });
rac = await popisRacuna(E.DB, 't1');
ok(r.ok && rac.length === 3 && !rac.some((x) => x.mreza === 'instagram' && x.vanjskiId === '778'), 'sinkronizacija ne vraća uklonjeni Instagram račun');
// ponovno dodavanje istog računa je moguće (stari je neaktivan)
const opet = await dodajRacun(E.DB, 't1', { mreza: 'instagram', id_stranice: '556222', naziv: '@piccolini.sivanje' });
ok(opet.length === 1, 'uklonjeni račun se može ponovno dodati (Facebook stranica je ostala)');

// uklonjeni računi se ne vraćaju zbog stare tajne META_STRANICA
const db2 = nova(); const E2 = env(db2, { META_STRANICA: '555111' });
const m2 = laznaMeta();
await sinkronizirajMetu(E2, 't1', { fetchFn: m2.fetchFn });
for (const x of await popisRacuna(E2.DB, 't1')) await ukloniRacun(E2.DB, 't1', x.id);
r = await sinkronizirajMetu(E2, 't1', { fetchFn: m2.fetchFn });
ok(!r.ok && /Nema dodanih/.test(r.greska) && (await popisRacuna(E2.DB, 't1')).length === 0, 'stara tajna ne vraća račune koje je čovjek uklonio');

// ============ 6) TikTok račun (ručni uvoz) i zakupci ============
const tt = await dodajRacun(E.DB, 't1', { mreza: 'tiktok', naziv: 'piccolini.play', usluga: 'oboje' });
ok(tt.length === 1 && tt[0].naziv === '@piccolini.play', 'TikTok račun dobiva @ ispred imena');
await baca(() => dodajRacun(E.DB, 't1', { mreza: 'tiktok', naziv: '@Piccolini.Play' }), /već dodan/, 'isti TikTok račun dvaput (bez obzira na velika slova)');
ok((await popisRacuna(E.DB, 't1', { mreza: 'tiktok' })).length === 1 && (await popisRacuna(E.DB, 't2')).length === 0, 'popis po mreži i po zakupcu');
r = await sinkronizirajMetu(E, 't1', { fetchFn: meta.fetchFn });
ok(r.ok && (await popisRacuna(E.DB, 't1', { mreza: 'tiktok' }))[0].status === 'rucno', 'Meta sinkronizacija ne dira TikTok račun');

console.log(pali ? `\n${pali} provjera nije prošlo` : '\nSve provjere su prošle');
