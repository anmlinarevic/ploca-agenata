// Svježa lokalna baza (zasebna mapa, ne dira `npm run dev`) → migracije → uvoz → tokeni i korisnici
// → serveri (MCP samostalno; dashboard + izvršitelj + MCP zajedno) + lažni Claude API → testovi → gašenje samo vlastitih procesa.
// Upotreba: node scripts/test-lokalno.mjs <mapa-s-izvozom-stare-ploce>
// Privremeno piše apps/dashboard/.dev.vars i apps/izvrsitelj/.dev.vars; postojeće sadržaje vraća na kraju.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

const izvoz = process.argv[2];
if (!izvoz) { console.error('Upotreba: node scripts/test-lokalno.mjs <mapa-s-izvozom>'); process.exit(1); }
// Portovi se mogu promijeniti ako je neki zauzet (npr. ostao je stari `wrangler dev`): PORT_PLOCA, PORT_MCP.
const PLOCA = process.env.PORT_PLOCA || '8798', MCPP = process.env.PORT_MCP || '8799';
const P_URL = `http://localhost:${PLOCA}`, M_URL = `http://localhost:${MCPP}`;
const CFG = ['--config', 'apps/mcp/wrangler.jsonc'];
const DB_STATE = '.wrangler-test/state';
const sh = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
  return r.stdout;
};
const d1 = (datoteka) => sh('npx', ['wrangler', 'd1', 'execute', 'ploca', '--local', ...CFG, '--persist-to', DB_STATE, `--file=${datoteka}`]);

// .dev.vars: sačuvaj postojeće i vrati na kraju
const DEVVARS = ['apps/dashboard/.dev.vars', 'apps/izvrsitelj/.dev.vars'];
const sacuvano = Object.fromEntries(DEVVARS.map((p) => [p, existsSync(p) ? readFileSync(p, 'utf8') : null]));
const vrati = () => DEVVARS.forEach((p) => (sacuvano[p] === null ? rmSync(p, { force: true }) : writeFileSync(p, sacuvano[p])));
process.on('exit', vrati);

// Pepper koji koristi MCP u zajedničkom procesu dolazi iz apps/mcp/.dev.vars (ili je prazan)
const pepperMcp = existsSync('apps/mcp/.dev.vars')
  ? (/^TOKEN_PEPPER=(.*)$/m.exec(readFileSync('apps/mcp/.dev.vars', 'utf8'))?.[1] ?? '').trim() : '';
const pepperTest = 'test-pepper';

rmSync('.wrangler-test', { recursive: true, force: true });
sh('node', ['scripts/uvoz-piccolini.mjs', `"${izvoz}"`, 'tenants/piccolini/seed.sql']);
sh('npx', ['wrangler', 'd1', 'migrations', 'apply', 'ploca', '--local', ...CFG, '--persist-to', DB_STATE]);
d1('tenants/piccolini/seed.sql');
sh('node', ['scripts/uvoz-registara.mjs', '"' + join(izvoz, '..', '..') + '"', 'tenants/piccolini/registri.sql']);
d1('tenants/piccolini/registri.sql');
// Tkanine sa stranice (repozitorij Tina-Obrt: <izvoz>/../../../../podaci/dezeni.json)
sh('node', ['scripts/uvoz-artikala.mjs', 'piccolini', '"' + join(izvoz, '..', '..', '..', '..', 'podaci', 'dezeni.json') + '"', 'tenants/piccolini/artikli.sql']);
d1('tenants/piccolini/artikli.sql');

// jedan poziv po agentu: ispiše token, a SQL zapiše u datoteku
const izdaj = (agent, pepper) => {
  const r = spawnSync('node', ['scripts/novi-token.mjs', 'piccolini', agent, 'zadano', `tenants/piccolini/token-test-${agent}.sql`],
    { encoding: 'utf8', env: { ...process.env, TOKEN_PEPPER: pepper } });
  const t = /TOKEN[^:]*: (\S+)/.exec(r.stdout)[1];
  d1(`tenants/piccolini/token-test-${agent}.sql`);
  return t;
};
const tKoord = izdaj('koordinator', pepperTest);
const tKonk = izdaj('konkurencija', pepperTest);
const tSeo = izdaj('seo', pepperTest);
const agentTokeni = { piccolini: Object.fromEntries(['koordinator', 'konkurencija', 'seo', 'ai', 'sadrzaj', 'lokalno'].map((a) => [a, izdaj(a, pepperMcp)])) };

const korisnik = (...a) => spawnSync('node', ['scripts/novi-korisnik.mjs', ...a], { encoding: 'utf8' }).stdout;
writeFileSync('tenants/piccolini/token-test-korisnici.sql',
  korisnik('vlasnik@test.hr', 'vlasnik', 'piccolini') + korisnik('savjetnik@test.hr', 'savjetnik') +
  "INSERT INTO tenants (id, naziv) VALUES ('drugi', 'Drugi klijent');\n" +
  "INSERT INTO odluke (id, tenant_id, naslov, agent, kreirano) VALUES ('x1', 'drugi', 'Tuđa odluka', 'seo', '2026-11-21T10:00:00Z');\n");
d1('tenants/piccolini/token-test-korisnici.sql');

// Testni ključ servisnog računa za lažni Google (javni ključ dobiva fake-gsc.mjs i njime provjerava potpis JWT-a).
const gscPar = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const gscKljuc = { type: 'service_account', client_email: 'ploca@test-projekt.iam.gserviceaccount.com', private_key: gscPar.privateKey, token_uri: 'http://localhost:8793/token' };
writeFileSync('apps/dashboard/.dev.vars','DEV_USER=*\nINTERNI_KLJUC=test-interni\nPARRA_API_KLJUC=test-parra\nPARRA_SUBJEKT=123\nPARRA_URL=http://localhost:8791\nMETA_TOKEN=test-meta\nMETA_STRANICA=555\nMETA_URL=http://localhost:8792\n' +
  `GSC_KLJUC='${JSON.stringify(gscKljuc)}'\nGSC_SVOJSTVO=sc-domain:piccoliniplay.hr\nGSC_API_URL=http://localhost:8793\nGSC_TOKEN_URL=http://localhost:8793/token\n`);
writeFileSync('apps/izvrsitelj/.dev.vars',
  `ANTHROPIC_API_KEY=test-kljuc\nANTHROPIC_BASE_URL=http://localhost:8790\nINTERNI_KLJUC=test-interni\nAGENT_TOKENS='${JSON.stringify(agentTokeni)}'\n`);

const procesi = [];
const pokreni = (args) => { const p = spawn('npx', args, { shell: true, stdio: 'ignore' }); procesi.push(p); return p; };
const cekaj = async (url) => {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).status < 500) return true; } catch { /* još se diže */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
};
const ugasi = () => procesi.forEach((p) => spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { shell: true }));
const node = (skripta, env = {}, args = []) =>
  spawnSync('node', [skripta, ...args], { stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;

const lazni = spawn('node', ['scripts/fake-anthropic.mjs'], { stdio: 'ignore' }); procesi.push(lazni);
procesi.push(spawn('node', ['scripts/fake-parra.mjs'], { stdio: 'ignore' }));
procesi.push(spawn('node', ['scripts/fake-meta.mjs'], { stdio: 'ignore' }));
procesi.push(spawn('node', ['scripts/fake-gsc.mjs'], { stdio: 'ignore', env: { ...process.env, GSC_JAVNI: gscPar.publicKey } }));
pokreni(['wrangler', 'dev', '--config', 'apps/mcp/wrangler.jsonc', '--port', MCPP, '--persist-to', DB_STATE, '--var', `TOKEN_PEPPER:${pepperTest}`]);
pokreni(['wrangler', 'dev', '-c', 'apps/dashboard/wrangler.jsonc', '-c', 'apps/izvrsitelj/wrangler.jsonc', '-c', 'apps/mcp/wrangler.jsonc',
  '--port', PLOCA, '--persist-to', DB_STATE]);

let kod = 1;
if ((await cekaj(M_URL + '/health')) && (await cekaj(P_URL + '/')) && (await cekaj('http://localhost:8790/zahtjevi'))) {
  kod = node('scripts/poslovanje-test.mjs')
    || node('scripts/smoke-test.mjs', { URL: M_URL, TOKEN: tKoord, TOKEN_KONK: tKonk, TOKEN_SEO: tSeo })
    || node('scripts/dashboard-test.mjs', { URL: P_URL })
    || node('scripts/poslovanje-api-test.mjs', { URL: P_URL, MCP: M_URL, TOKEN: tKoord })
    || node('scripts/parra-test.mjs', { URL: P_URL, PARRA: 'http://localhost:8791' })
    || node('scripts/meta-test.mjs', { URL: P_URL, META: 'http://localhost:8792' })
    || node('scripts/gsc-test.mjs', { URL: P_URL, GSC: 'http://localhost:8793' })
    || node('scripts/izvrsitelj-test.mjs', { URL: P_URL, MCP: M_URL, TOKEN: tKoord }, ['faza1']);
  if (kod === 0) {
    writeFileSync('tenants/piccolini/token-test-limit.sql',
      `UPDATE tenants SET postavke_json = '{"limit_usd":0.01}' WHERE id = 'piccolini';\n`);
    d1('tenants/piccolini/token-test-limit.sql');
    kod = node('scripts/izvrsitelj-test.mjs', { URL: P_URL }, ['faza2']);
  }
} else console.error('Serveri se nisu pokrenuli');
ugasi();
process.exit(kod);
