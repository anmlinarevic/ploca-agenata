#!/usr/bin/env node
// Artikli skladišta za zakupca: tkanine iz podaci/dezeni.json sa stranice + ostali materijal. Ponovni uvoz ne briše stanje
// ni prag koji je vlasnik promijenio (INSERT OR IGNORE); naziv, boja i izvor tkanine se osvježavaju.
// Upotreba: node scripts/uvoz-artikala.mjs <zakupac> <put/do/dezeni.json> <izlaz.sql>
import { readFileSync, writeFileSync } from 'node:fs';

const [zakupac, dezeniPut, izlaz] = process.argv.slice(2);
if (!zakupac || !dezeniPut || !izlaz) { console.error('Upotreba: node scripts/uvoz-artikala.mjs <zakupac> <dezeni.json> <izlaz.sql>'); process.exit(1); }
const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

const dezeni = JSON.parse(readFileSync(dezeniPut, 'utf8'));
// Prag 0,4 m² ≈ 5 slova 15 × 15 cm. Vlasnik ga mijenja na ploči po tkanini.
const TKANINA_PRAG = 0.4;
const OSTALO = [
  ['spaga', 'Pamučna špaga', 'spaga', 'm', 10],
  ['traka', 'Keper traka za vješanje', 'traka', 'm', 5],
  ['perle', 'Drvene perle', 'perle', 'kom', 20],
  ['masnice', 'Ukrasne mašnice', 'masnice', 'par', 5],
  ['punilo', 'Punilo (vlakno)', 'punilo', 'g', 500],
  ['boxnow-s', 'BoxNow kutija S', 'ambalaza', 'kom', 5],
];

const redovi = [];
dezeni.forEach((d, i) => {
  redovi.push(`INSERT INTO artikli (tenant_id, id, naziv, kategorija, jedinica, prag, boja, izvor, izvor_url, aktivno, red)
VALUES (${q(zakupac)}, ${q(d.sifra)}, ${q(d.naziv)}, 'tkanina', 'm2', ${TKANINA_PRAG}, ${q(d.pozadina)}, ${q(d.izvor)}, ${q(d.izvor_url)}, ${d.dostupno === false ? 0 : 1}, ${i})
ON CONFLICT (tenant_id, id) DO UPDATE SET naziv = excluded.naziv, boja = excluded.boja, izvor = excluded.izvor, izvor_url = excluded.izvor_url, aktivno = excluded.aktivno, red = excluded.red;`);
});
OSTALO.forEach(([id, naziv, kat, jed, prag], i) => {
  redovi.push(`INSERT OR IGNORE INTO artikli (tenant_id, id, naziv, kategorija, jedinica, prag, red) VALUES (${q(zakupac)}, ${q(id)}, ${q(naziv)}, ${q(kat)}, ${q(jed)}, ${prag}, ${1000 + i});`);
});
writeFileSync(izlaz, redovi.join('\n') + '\n');
console.log(`${dezeni.length} tkanina i ${OSTALO.length} ostalih artikala → ${izlaz}`);
