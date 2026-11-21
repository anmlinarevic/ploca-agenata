#!/usr/bin/env node
// Pretvara izvoz stare ploče (JSON po kolekcijama) u SQL za zakupca "piccolini".
// Upotreba: node scripts/uvoz-piccolini.mjs <mapa-s-izvozom> [izlaz.sql]
// Zatim: wrangler d1 execute ploca --local --file=<izlaz.sql>   (ili --remote)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [ulaz, izlaz = 'tenants/piccolini/seed.sql'] = process.argv.slice(2);
if (!ulaz) { console.error('Upotreba: node scripts/uvoz-piccolini.mjs <mapa-s-izvozom> [izlaz.sql]'); process.exit(1); }

const T = 'piccolini';
const q = (v) => (v === undefined || v === null ? 'NULL'
  : typeof v === 'number' ? String(v)
  : typeof v === 'boolean' ? (v ? '1' : '0')
  : `'${String(v).replaceAll("'", "''")}'`);
const j = (v) => (v === undefined || v === null ? 'NULL' : q(JSON.stringify(v)));
const citaj = (kol) => {
  try {
    return readdirSync(join(ulaz, kol)).filter((f) => f.endsWith('.json'))
      .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(ulaz, kol, f), 'utf8'))]);
  } catch { return []; }
};
const ins = (tablica, o) =>
  `INSERT INTO ${tablica} (${Object.keys(o).join(', ')}) VALUES (${Object.values(o).join(', ')});`;

const sql = [
  '-- Generirano skriptom uvoz-piccolini.mjs. Ne uređuj ručno.',
  `INSERT OR IGNORE INTO tenants (id, naziv, domena, jezik) VALUES ('${T}', 'Piccolini Play', 'piccoliniplay.hr', 'hr');`,
];

for (const [id, d] of citaj('odluke')) {
  sql.push(ins('odluke', {
    id: q(id), tenant_id: q(T), naslov: q(d.naslov), agent: q(d.agent), razlog: q(d.razlog),
    prijedlog: q(d.prijedlog), poveznica: q(d.poveznica), poveznica_tekst: q(d.poveznicaTekst),
    prioritet: q(d.prioritet ?? 2), status: q(d.status ?? 'ceka'), kreirano: q(d.kreirano),
    komentar: q(d.komentar || null), odluceno_at: q(d.odlucenoAt), rezultat: q(d.rezultat),
  }));
}
for (const [id, d] of citaj('zadaci')) {
  sql.push(ins('zadaci', {
    id: q(id), tenant_id: q(T), opis: q(d.opis), agent: q(d.agent), rok: q(d.rok),
    status: q(d.status ?? 'novo'), kreirano: q(d.kreirano), sesija: q(d.sesija?.url ?? d.sesija),
    rezultat: q(d.rezultat), poveznica: q(d.poveznica),
  }));
}
for (const [id, d] of citaj('tjedni')) {
  sql.push(ins('tjedni', {
    tenant_id: q(T), tjedan: q(id), od: q(d.od), upiti_banner: q(d.upitiBanner),
    upiti_igraonica: q(d.upitiIgraonica), narudzbe: q(d.narudzbe), rezervacije: q(d.rezervacije),
    recenzije: q(d.recenzije), izvori_json: j(d.izvori ?? {}),
  }));
}
for (const [id, d] of citaj('mjesecno')) {
  sql.push(ins('mjesecno', {
    tenant_id: q(T), mjesec: q(id), ai_spominjanja: q(d.aiSpominjanja), ai_pitanja: q(d.aiPitanja),
    gsc_klikovi: q(d.gscKlikovi), gsc_pojavljivanja: q(d.gscPojavljivanja), napomena: q(d.napomena),
  }));
}
for (const [id, d] of citaj('napredak')) {
  sql.push(ins('napredak_faze', { tenant_id: q(T), id: q(id), naziv: q(d.naziv), kad: q(d.kad), red: q(d.red ?? 0) }));
  (d.stavke || []).forEach((s, i) => sql.push(ins('napredak_stavke', {
    tenant_id: q(T), faza_id: q(id), red: q(i), t: q(s.t), gotovo: q(!!s.gotovo), tko: q(s.tko),
  })));
}
for (const [id, d] of citaj('aktivnost')) {
  sql.push(ins('aktivnost', {
    id: q(id), tenant_id: q(T), kad: q(d.kad), agent: q(d.agent), sto: q(d.sto), poveznica: q(d.poveznica),
  }));
}
for (const [id, d] of citaj('konkurenti')) {
  sql.push(ins('konkurenti', {
    id: q(id), tenant_id: q(T), naziv: q(d.naziv), mi: q(!!d.mi), trziste: q(d.trziste), razina: q(d.razina),
    red: q(d.red ?? 0), izvor: q(d.izvor), provjereno: q(d.provjereno), proizvod: q(d.proizvod),
    cijena_tekst: q(d.cijenaTekst), velicina: q(d.velicina), vrsta: q(d.vrsta), mjesto: q(d.mjesto),
    napomena: q(d.napomena), usporedba_json: j(d.usporedba), prednosti_json: j(d.prednosti),
  }));
}

writeFileSync(izlaz, sql.join('\n') + '\n');
console.log(`Zapisano ${sql.length - 2} redaka u ${izlaz}`);
