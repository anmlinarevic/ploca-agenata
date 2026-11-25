#!/usr/bin/env node
// Lokalni demo Kalendara i Skladišta s izmišljenim narudžbama (datumi oko današnjeg tjedna).
// Zasebna baza (.wrangler-demo), ne dira `npm run dev` ni testove. Prijava: demo@primjer.hr (DEV_USER, samo lokalno).
// Upotreba: npm run demo [-- <put/do/dezeni.json>]   → http://localhost:8797/kalendar.html
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { norme, normalizirajStavku, potrosnjaNarudzbe, datumZagreb, dodajDane, ponedjeljak } from '../packages/poslovanje/index.js';

const dezeni = resolve(process.argv[2] || join('..', 'tina-obrt', 'podaci', 'dezeni.json'));
if (!existsSync(dezeni)) { console.error(`Nema ${dezeni}. Upotreba: npm run demo -- <put/do/dezeni.json>`); process.exit(1); }
const STATE = '.wrangler-demo/state';
const CFG = ['--config', 'apps/dashboard/wrangler.jsonc'];
const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
};
const d1 = (f) => sh('npx', ['wrangler', 'd1', 'execute', 'ploca', '--local', ...CFG, '--persist-to', STATE, `--file=${f}`]);

rmSync('.wrangler-demo', { recursive: true, force: true });
mkdirSync('.wrangler-demo', { recursive: true });
console.log('Baza i migracije…');
sh('npx', ['wrangler', 'd1', 'migrations', 'apply', 'ploca', '--local', ...CFG, '--persist-to', STATE]);
sh('node', ['scripts/uvoz-artikala.mjs', 'piccolini', `"${dezeni}"`, '.wrangler-demo/artikli.sql']);

const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
const id = () => randomUUID().replaceAll('-', '').slice(0, 12);
const n = norme();
const danas = datumZagreb();
const pon = ponedjeljak(danas);
const D = (k) => dodajDane(pon, k);                 // dan ovog tjedna (0 = ponedjeljak)
const prije = (dana) => new Date(Date.now() - dana * 86400000).toISOString();
const sql = [
  `INSERT INTO tenants (id, naziv) VALUES ('piccolini', 'Piccolini Play');`,
  `INSERT INTO users (id, tenant_id, email, uloga) VALUES ('${randomUUID()}', 'piccolini', 'demo@primjer.hr', 'vlasnik');`,
];
const kretanje = (artikl, vrsta, kolicina, kad, narudzba = null, napomena = null) =>
  sql.push(`INSERT INTO skladiste_kretanja (tenant_id, id, artikl_id, vrsta, kolicina, kad, narudzba_id, napomena, tko)
VALUES ('piccolini', ${q(id())}, ${q(artikl)}, ${q(vrsta)}, ${kolicina}, ${q(kad)}, ${q(narudzba)}, ${q(napomena)}, 'user:demo');`);

// Inventura prije 25 dana i potrošnja u zadnja 4 tjedna (za tempo).
const STANJE = { D12: 1.6, D21: 2.4, D22: 1.1, D01: 3.0, D06: 0.55, D18: 0.9, D25: 1.8, D30: 0.35, D24: 2.2, D14: 1.3 };
for (const [a, k] of Object.entries(STANJE)) kretanje(a, 'inventura', k, prije(25), null, 'Demo inventura');
for (const [a, k, dana] of [['D12', 0.31, 18], ['D12', 0.23, 9], ['D21', 0.23, 12], ['D06', 0.15, 6], ['D30', 0.12, 15], ['D18', 0.08, 4]]) kretanje(a, 'potrosnja', k, prije(dana), null, 'Ranije narudžbe');
kretanje('D21', 'ulaz', 1.5, prije(3), null, '1 m s bale 150 cm');
for (const [a, k] of [['spaga', 32], ['traka', 9], ['perle', 40], ['masnice', 6], ['punilo', 1800], ['boxnow-s', 4]]) kretanje(a, 'inventura', k, prije(25), null, 'Demo inventura');

const banner = (tekst, dezeni, motivi = [], zavrsetak = 'perle') => normalizirajStavku({ proizvod: 'banner', tekst, dezeni, motivi, zavrsetak });
const NARUDZBE = [
  { sifra: 'N-0139', opis: 'Slinčeki, set od 3', stanje: 'gotovo', rok: D(1), dostava: 'boxnow', stavke: [{ proizvod: 'ostalo', opis: 'Slinčeki, set od 3', sati: 1.5, potrosnja: [] }], izrada: [] },
  { sifra: 'N-0142', opis: 'Banner za krštenje, ruža i menta', stanje: 'potvrdjeno', rok: D(2), dostava: 'preuzimanje', stavke: [banner('LUCIJA', ['D12', 'D12', 'D12', 'D22'])], izrada: [{ dan: D(0), sati: 1.75 }] },
  { sifra: 'N-0143', opis: 'Rođendanski natpis', stanje: 'u_izradi', rok: D(4), dostava: 'boxnow', stavke: [banner('SRETAN ROĐENDAN', ['D21', 'D21', 'D21', 'D21', 'D21', 'D21', 'D12'], [{ m: 'balon', dezen: 'D12' }, { m: 'balon', dezen: 'D12' }], 'masnice')], izrada: [{ dan: D(1), sati: 2.5 }, { dan: D(3), sati: 2 }] },
  { sifra: 'N-0145', opis: 'Tiha knjiga, životinje na farmi', stanje: 'potvrdjeno', rok: D(9), dostava: 'preuzimanje', stavke: [{ proizvod: 'ostalo', opis: 'Tiha knjiga, 8 stranica', sati: 3, potrosnja: [{ artikl: 'D24', kolicina: 0.3 }, { artikl: 'D06', kolicina: 0.2 }] }], izrada: [{ dan: D(3), sati: 3 }] },
  { sifra: 'N-0146', opis: 'Banner za dječju sobu s autićem', stanje: 'potvrdjeno', rok: D(4), dostava: 'boxnow', stavke: [banner('MARKO', ['D25'], [{ m: 'auto', dezen: 'D18' }])], izrada: [{ dan: D(3), sati: 1.5 }] },
  { sifra: 'N-0147', opis: 'Banner, krem i lila', stanje: 'potvrdjeno', rok: D(10), dostava: 'preuzimanje', stavke: [banner('EMA', ['D30'])], izrada: [{ dan: D(4), sati: 1 }] },
  { sifra: 'N-0148', opis: 'Banner, ponuda poslana', stanje: 'ponuda', rok: D(12), dostava: 'boxnow', stavke: [banner('NIKA', ['D14'])], izrada: [] },
];
for (const x of NARUDZBE) {
  const nid = id();
  const st = x.stavke.map((s) => (s.proizvod === 'ostalo' ? { ...s } : s));
  const sati = potrosnjaNarudzbe({ stavke: st, dostava: x.dostava }, n).sati;
  sql.push(`INSERT INTO narudzbe (tenant_id, id, sifra, usluga, opis, stanje, rok, izrada_json, sati_procjena, dostava, stavke_json, kreirano, azurirano)
VALUES ('piccolini', ${q(nid)}, ${q(x.sifra)}, 'sivanje', ${q(x.opis)}, ${q(x.stanje)}, ${q(x.rok)}, ${q(JSON.stringify(x.izrada))}, ${sati}, ${q(x.dostava)}, ${q(JSON.stringify(st))}, ${q(prije(5))}, ${q(prije(1))});`);
  if (['u_izradi', 'gotovo'].includes(x.stanje)) {
    for (const [a, k] of Object.entries(potrosnjaNarudzbe({ stavke: st, dostava: x.dostava }, n).po)) kretanje(a, 'potrosnja', k, prije(2), nid, `Narudžba ${x.sifra}`);
  }
}
// Igraonica: opcija ističe za oko 26 sati.
const opcijaDo = new Date(Date.now() + 26 * 3600000).toISOString();
for (const [sifra, opis, stanje, dan, od, doo, opc] of [
  ['R-029', 'Rođendan u stanu, Dugo Selo', 'potvrdjeno', D(4), '16:00', '19:00', null],
  ['R-031', 'Rođendan, 10 djece', 'opcija', D(5), '10:00', '13:00', opcijaDo],
  ['R-030', 'Rođendan u dvorani, Rugvica', 'potvrdjeno', D(6), '15:00', '18:00', null],
]) sql.push(`INSERT INTO narudzbe (tenant_id, id, sifra, usluga, opis, stanje, termin_od, termin_do, opcija_do, dostava, stavke_json, izrada_json, kreirano, azurirano)
VALUES ('piccolini', ${q(id())}, ${q(sifra)}, 'igraonica', ${q(opis)}, ${q(stanje)}, ${q(`${dan}T${od}`)}, ${q(`${dan}T${doo}`)}, ${q(opc)}, 'montaza', '[]', '[]', ${q(prije(4))}, ${q(prije(1))});`);

// Glavna ploča: odluke, zadaci, napredak i dnevnik (izmišljeno, za pregled izgleda).
const odluka = (agent, p, status, naslov, prijedlog, razlog, dana, extra = {}) => sql.push(`INSERT INTO odluke (id, tenant_id, naslov, agent, razlog, prijedlog, prioritet, status, kreirano, komentar, odluceno_at, rezultat)
VALUES (${q(id())}, 'piccolini', ${q(naslov)}, ${q(agent)}, ${q(razlog)}, ${q(prijedlog)}, ${p}, ${q(status)}, ${q(prije(dana))}, ${q(extra.komentar)}, ${q(extra.odluceno ? prije(extra.odluceno) : null)}, ${q(extra.rezultat)});`);
odluka('koordinator', 2, 'ceka', 'Odabrati konektor za Google i Meta statistiku', 'Jedan posrednik za Instagram i Google profil tvrtke. Prije spajanja provjeri cijenu.', 'Google i Meta nemaju službeni konektor. Bez plaćanja ostaje mjesečni izvoz iz Search Consolea.', 3);
odluka('koordinator', 2, 'ceka', 'Kako pokretati agente', 'Prva 2–3 tjedna ručno, zakazani pregledi kad vidiš da su sažeci korisni.', 'Pregledi se mogu pokretati sami: ponedjeljkom tjedni, 1. u mjesecu mjesečni. Svaki pregled troši Claude API.', 3);
odluka('sadrzaj', 1, 'ceka', 'Plan objava za prosinac', 'Pregledaj i odobri prvi tjedan; ostalo pregledavamo tjedno.', '40 objava (30 za bannere, 10 za igraonicu) s gotovim tekstom i opisom kadra.', 2);
odluka('lokalno', 3, 'ceka', 'Predlošci poruka za Google recenzije', 'Odobri tekstove; slanje kreće kad otvoriš Google profil.', 'Poruke nakon bannera i nakon igraonice te tri odgovora na recenzije.', 2);
odluka('seo', 3, 'ceka', 'Naslov stranice /igraonica', 'Dodati „Dugo Selo” u naslov i opis stranice.', 'Upiti s lokacijom čine većinu pretraga za igraonice u okolici.', 1);
odluka('koordinator', 1, 'odobreno', 'Spojiti Gmail da agenti broje upite', null, null, 3, { odluceno: 2, komentar: 'Prvo dopuna politike privatnosti.' });
odluka('sadrzaj', 2, 'odobreno', 'Savjet „objesiti izvan dohvata djeteta”', null, null, 3, { odluceno: 2, rezultat: 'Jedna rečenica ide u FAQ na /banneri i u objave o dječjoj sobi.' });
odluka('seo', 1, 'gotovo', 'Potvrdi upute za održavanje bannera', null, null, 4, { odluceno: 3, rezultat: 'Upute na stranici i u FAQ-u ostaju kako su napisane.' });
odluka('sadrzaj', 2, 'odbijeno', 'Rok narudžbe za Božić', null, null, 4, { odluceno: 3, komentar: 'Bez roka: ide zamjenska objava.' });
const zadatak = (agent, status, opis, dana, rok, rezultat = null) => sql.push(`INSERT INTO zadaci (id, tenant_id, opis, agent, rok, status, kreirano, rezultat)
VALUES (${q(id())}, 'piccolini', ${q(opis)}, ${q(agent)}, ${q(rok)}, ${q(status)}, ${q(prije(dana))}, ${q(rezultat)});`);
zadatak('konkurencija', 'u_izradi', 'Provjeri cijene bannera kod slovenskih prodavača i javi je li se nešto promijenilo', 0.2, D(2));
zadatak('seo', 'novo', 'Predloži 5 ključnih riječi za igraonicu u Dugom Selu i okolici', 0.5, D(4));
zadatak('sadrzaj', 'gotovo', 'Napiši 3 objave za prvi tjedan prosinca', 2, D(0), 'Tri nacrta su u izvještaju „Objave 1. – 7. 12.”: banner za krštenje, igraonica za rođendan u stanu i „iza kulisa” šivanja.');
for (const [fid, naziv, kad, red, stavke] of [
  ['faza0', 'Temelji', 'studeni 2026.', 0, [['Ploča agenata na Cloudflareu', 1], ['Narudžbe, kalendar i skladište', 1], ['Google Search Console i sitemap', 0], ['Google profil tvrtke', 0]]],
  ['faza1', 'Polazno stanje', 'prosinac 2026.', 1, [['Prvo mjerenje upita i recenzija', 0], ['Inventura tkanina', 0]]],
]) {
  sql.push(`INSERT INTO napredak_faze (tenant_id, id, naziv, kad, red) VALUES ('piccolini', ${q(fid)}, ${q(naziv)}, ${q(kad)}, ${red});`);
  stavke.forEach(([t, g], i) => sql.push(`INSERT INTO napredak_stavke (tenant_id, faza_id, red, t, gotovo) VALUES ('piccolini', ${q(fid)}, ${i}, ${q(t)}, ${g});`));
}
for (const [agent, sto, sati] of [
  ['koordinator', 'Tjedni pregled gotov: konkurencija, pa koordinator.', 5], ['ti', 'Odbijeno: rok narudžbe za Božić', 70], ['ti', 'Odobreno: upute za održavanje bannera', 71],
  ['konkurencija', 'Usporedba cijena: 4 slovenska prodavača i 5 igraonica', 80], ['sadrzaj', 'Plan 40 objava i nacrt vodiča o poklonu za krštenje', 90], ['lokalno', 'Popis 12 sala i restorana, predlošci za recenzije', 92],
]) sql.push(`INSERT INTO aktivnost (id, tenant_id, kad, agent, sto) VALUES (${q(id())}, 'piccolini', ${q(prije(sati / 24))}, ${q(agent)}, ${q(sto)});`);

// Zakupac i korisnik prvi (artikli imaju strani ključ na zakupca).
writeFileSync('.wrangler-demo/zakupac.sql', sql.splice(0, 2).join('\n') + '\n');
writeFileSync('.wrangler-demo/demo.sql', sql.join('\n') + '\n');
d1('.wrangler-demo/zakupac.sql');
d1('.wrangler-demo/artikli.sql');
d1('.wrangler-demo/demo.sql');

console.log('\nDemo je spreman: http://localhost:8797/kalendar.html  (Ctrl+C za kraj)');
console.log('Lažni Parra (izmišljene ponude) na :8791; gumb „Osvježi iz Parre” ih učita.\n');
spawn('node', ['scripts/fake-parra.mjs'], { stdio: 'ignore' });
spawn('node', ['scripts/fake-meta.mjs'], { stdio: 'ignore' });
spawn('npx', ['wrangler', 'dev', ...CFG, '--port', '8797', '--persist-to', STATE, '--var', 'DEV_USER:demo@primjer.hr',
  '--var', 'PARRA_API_KLJUC:test-parra', '--var', 'PARRA_SUBJEKT:123', '--var', 'PARRA_URL:http://localhost:8791',
  '--var', 'META_TOKEN:test-meta', '--var', 'META_STRANICA:555', '--var', 'META_URL:http://localhost:8792'], { stdio: 'inherit', shell: true });
