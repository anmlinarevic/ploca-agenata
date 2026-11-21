// Svježa lokalna baza (zasebna mapa, ne dira `npm run dev`) → migracije → uvoz → tokeni i korisnici
// → serveri (MCP + dashboard) → testovi → gašenje samo vlastitih procesa.
// Upotreba: node scripts/test-lokalno.mjs <mapa-s-izvozom-stare-ploce>
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';

const izvoz = process.argv[2];
if (!izvoz) { console.error('Upotreba: node scripts/test-lokalno.mjs <mapa-s-izvozom>'); process.exit(1); }
const CFG = ['--config', 'apps/mcp/wrangler.jsonc'];
const DB_STATE = '.wrangler-test/state';
const sh = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
  return r.stdout;
};
const d1 = (datoteka) => sh('npx', ['wrangler', 'd1', 'execute', 'ploca', '--local', ...CFG, '--persist-to', DB_STATE, `--file=${datoteka}`]);

rmSync('.wrangler-test', { recursive: true, force: true });
const pepper = 'test-pepper';
sh('node', ['scripts/uvoz-piccolini.mjs', `"${izvoz}"`, 'tenants/piccolini/seed.sql']);
sh('npx', ['wrangler', 'd1', 'migrations', 'apply', 'ploca', '--local', ...CFG, '--persist-to', DB_STATE]);
d1('tenants/piccolini/seed.sql');

// jedan poziv po agentu: ispiše token, a SQL zapiše u datoteku
const izdaj = (agent) => {
  const r = spawnSync('node', ['scripts/novi-token.mjs', 'piccolini', agent, 'zadano', `tenants/piccolini/token-test-${agent}.sql`],
    { encoding: 'utf8', env: { ...process.env, TOKEN_PEPPER: pepper } });
  const t = /TOKEN[^:]*: (\S+)/.exec(r.stdout)[1];
  d1(`tenants/piccolini/token-test-${agent}.sql`);
  return t;
};
const tKoord = izdaj('koordinator');
const tKonk = izdaj('konkurencija');

const korisnik = (...a) => spawnSync('node', ['scripts/novi-korisnik.mjs', ...a], { encoding: 'utf8' }).stdout;
writeFileSync('tenants/piccolini/token-test-korisnici.sql',
  korisnik('vlasnik@test.hr', 'vlasnik', 'piccolini') + korisnik('savjetnik@test.hr', 'savjetnik') +
  "INSERT INTO tenants (id, naziv) VALUES ('drugi', 'Drugi klijent');\n" +
  "INSERT INTO odluke (id, tenant_id, naslov, agent, kreirano) VALUES ('x1', 'drugi', 'Tuđa odluka', 'seo', '2026-11-21T10:00:00Z');\n");
d1('tenants/piccolini/token-test-korisnici.sql');

const pokreni = (config, port, varijable) => spawn('npx',
  ['wrangler', 'dev', '--config', config, '--port', String(port), '--persist-to', DB_STATE, ...varijable.flatMap((v) => ['--var', v])],
  { shell: true, stdio: 'ignore' });
const cekaj = async (url) => {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(url)).status < 500) return true; } catch { /* još se diže */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
};
const ugasi = (p) => spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { shell: true });

const mcp = pokreni('apps/mcp/wrangler.jsonc', 8799, [`TOKEN_PEPPER:${pepper}`]);
const dash = pokreni('apps/dashboard/wrangler.jsonc', 8798, ['DEV_USER:*']);
let kod = 1;
if ((await cekaj('http://localhost:8799/health')) && (await cekaj('http://localhost:8798/'))) {
  const a = spawnSync('node', ['scripts/smoke-test.mjs'], {
    stdio: 'inherit', env: { ...process.env, URL: 'http://localhost:8799', TOKEN: tKoord, TOKEN_KONK: tKonk },
  });
  const b = spawnSync('node', ['scripts/dashboard-test.mjs'], { stdio: 'inherit', env: { ...process.env, URL: 'http://localhost:8798' } });
  kod = (a.status ?? 1) || (b.status ?? 1);
} else console.error('Serveri se nisu pokrenuli');
ugasi(mcp); ugasi(dash);
process.exit(kod);
