// Svježa lokalna baza → migracije → uvoz → tokeni → server → dimni test → gašenje.
// Upotreba: node scripts/test-lokalno.mjs <mapa-s-izvozom-stare-ploce>
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, readFileSync } from 'node:fs';

const izvoz = process.argv[2];
if (!izvoz) { console.error('Upotreba: node scripts/test-lokalno.mjs <mapa-s-izvozom>'); process.exit(1); }
const CFG = ['--config', 'apps/mcp/wrangler.jsonc'];
const sh = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
  return r.stdout;
};

rmSync('apps/mcp/.wrangler/state', { recursive: true, force: true });
const pepper = 'test-pepper';
sh('node', ['scripts/uvoz-piccolini.mjs', `"${izvoz}"`, 'tenants/piccolini/seed.sql']);
sh('npx', ['wrangler', 'd1', 'migrations', 'apply', 'ploca', '--local', ...CFG]);
sh('npx', ['wrangler', 'd1', 'execute', 'ploca', '--local', ...CFG, '--file=tenants/piccolini/seed.sql']);

// jedan poziv po agentu: ispiše token, a SQL zapiše u datoteku
const izdaj = (agent) => {
  const r = spawnSync('node', ['scripts/novi-token.mjs', 'piccolini', agent, 'zadano', `tenants/piccolini/token-test-${agent}.sql`],
    { encoding: 'utf8', env: { ...process.env, TOKEN_PEPPER: pepper } });
  const t = /TOKEN[^:]*: (\S+)/.exec(r.stdout)[1];
  sh('npx', ['wrangler', 'd1', 'execute', 'ploca', '--local', ...CFG, `--file=tenants/piccolini/token-test-${agent}.sql`]);
  return t;
};
const tKoord = izdaj('koordinator');
const tKonk = izdaj('konkurencija');

const server = spawn('npx', ['wrangler', 'dev', ...CFG, '--port', '8799', '--var', `TOKEN_PEPPER:${pepper}`],
  { shell: true, stdio: 'ignore' });
let gotov = false;
for (let i = 0; i < 40 && !gotov; i++) {
  try { gotov = (await fetch('http://localhost:8799/health')).ok; } catch { await new Promise((r) => setTimeout(r, 1500)); }
}
let kod = 1;
if (gotov) {
  const t = spawnSync('node', ['scripts/smoke-test.mjs'], {
    stdio: 'inherit', env: { ...process.env, URL: 'http://localhost:8799', TOKEN: tKoord, TOKEN_KONK: tKonk },
  });
  kod = t.status ?? 1;
} else console.error('Server se nije pokrenuo');
spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { shell: true });
process.exit(kod);
