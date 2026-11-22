#!/usr/bin/env node
// Pretvara Markdown registre i izvještaje iz repozitorija Tina-Obrt (docs/marketing) u SQL za zakupca "piccolini".
// Upotreba: node scripts/uvoz-registara.mjs <docs/marketing> [izlaz.sql]
// Zatim: wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --file=<izlaz.sql>
// Registri se UPISUJU samo ako još ne postoje (INSERT OR IGNORE): ponovni uvoz ne briše ono što su agenti već dopunili.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [mapa, izlaz = 'tenants/piccolini/registri.sql'] = process.argv.slice(2);
if (!mapa) { console.error('Upotreba: node scripts/uvoz-registara.mjs <docs/marketing> [izlaz.sql]'); process.exit(1); }

const T = 'piccolini';
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
const REGISTRI = [
  ['kljucne-rijeci', 'Ključne riječi', 'kljucne-rijeci.md'],
  ['ai-vidljivost', 'AI vidljivost: pitanja i rezultati', 'ai-vidljivost.md'],
  ['partneri', 'Partneri: sale, restorani, prostori', 'partneri.md'],
  ['dnevnik-odluka', 'Dnevnik odluka', 'dnevnik-odluka.md'],
  ['sadrzaj-plan', 'Plan sadržaja', 'sadrzaj/2026-12-plan.md'],
  ['recenzije-predlosci', 'Predlošci za recenzije', 'sadrzaj/recenzije-predlosci.md'],
];
const sql = [`INSERT OR IGNORE INTO tenants (id, naziv) VALUES (${q(T)}, 'Piccolini Play');`];
const kad = new Date().toISOString();
let n = 0;

for (const [kljuc, naslov, datoteka] of REGISTRI) {
  const put = join(mapa, datoteka);
  if (!existsSync(put)) { console.error(`PRESKOČENO (nema datoteke): ${datoteka}`); continue; }
  const tijelo = readFileSync(put, 'utf8');
  sql.push(`INSERT OR IGNORE INTO registri (tenant_id, kljuc, naslov, tijelo, verzija, azurirano, azurirao) VALUES (${q(T)}, ${q(kljuc)}, ${q(naslov)}, ${q(tijelo)}, 1, ${q(kad)}, 'uvoz');`);
  n++;
}

// Postojeći izvještaji (npr. 2026-11-20-lokalno.md): agent se uzima iz završetka imena datoteke
const izv = join(mapa, 'izvjestaji');
if (existsSync(izv)) {
  for (const f of readdirSync(izv).filter((x) => /^\d{4}-\d{2}-\d{2}-[a-z]+\.md$/.test(x))) {
    const [, datum, agent] = /^(\d{4}-\d{2}-\d{2})-([a-z]+)\.md$/.exec(f);
    const tijelo = readFileSync(join(izv, f), 'utf8');
    const naslov = /^#\s+(.+)$/m.exec(tijelo)?.[1] ?? f;
    sql.push(`INSERT OR IGNORE INTO izvjestaji (id, tenant_id, agent, kad, naslov, tijelo) VALUES (${q('uvoz-' + f.slice(0, -3))}, ${q(T)}, ${q(agent)}, ${q(datum + 'T08:00:00.000Z')}, ${q(naslov)}, ${q(tijelo)});`);
    n++;
  }
}

writeFileSync(izlaz, sql.join('\n') + '\n');
console.log(`Zapisano ${n} dokumenata u ${izlaz}`);
