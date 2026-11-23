# Ploča agenata

Višezakupnička ploča za marketinške (i druge) agente. Cloudflare Workers + D1 (EU) + MCP.
Prvi zakupac: `piccolini` (Piccolini Play). Plan: `tina-obrt/docs/marketing/ploca/PLAN-CLOUDFLARE.md`.

## Stanje
Korak 1 od 5: shema (`packages/db/migrations`), uvoz stare ploče, MCP server s alatima za čitanje.

## Lokalno
```
npm install
npm run migriraj:lokalno
node scripts/uvoz-piccolini.mjs <mapa-s-izvozom-stare-ploce>
npx wrangler d1 execute ploca --local --config apps/mcp/wrangler.jsonc --file=tenants/piccolini/seed.sql
echo TOKEN_PEPPER=lokalni > apps/mcp/.dev.vars
TOKEN_PEPPER=lokalni node scripts/novi-token.mjs piccolini koordinator '*' tenants/piccolini/token-lokalni.sql
npx wrangler d1 execute ploca --local --config apps/mcp/wrangler.jsonc --file=tenants/piccolini/token-lokalni.sql
npm run dev            # u drugom terminalu: TOKEN=pl_... npm test
```

## Pravila
- `tenant_id` dolazi samo iz tokena. Nema alata za odobravanje odluka, pisanje tjednih brojki ni brisanje.
- Tokeni se spremaju kao SHA-256 (pepper + token); pepper je secret.

## Korak 2: pisanje
Alati: `dodaj_odluku` (najviše 3 tjedno po agentu), `azuriraj_odluku_izvrsenje` (samo odobrene), `azuriraj_zadatak`,
`upisi_mjesecno`, `oznaci_napredak`, `dodaj_aktivnost`, `azuriraj_konkurenta` (naš red samo uz `odluka_id` odobrene odluke).
Svaka promjena upisuje red u `audit_log` u istom D1 batchu. Tokeni po ulozi agenta: `scripts/novi-token.mjs <zakupac> <agent>`
(zadani skup alata po agentu, vidi PRESETI). Test sa svježom lokalnom bazom: `npm test -- <mapa-s-izvozom>` →
`node scripts/test-lokalno.mjs <mapa>`.

## Spajanje Claude Codea (koordinator)
Kad je server na Cloudflareu, u repozitoriju klijenta `.mcp.json`:
```json
{ "mcpServers": { "ploca": { "type": "http", "url": "https://ploca-mcp.<račun>.workers.dev/mcp",
  "headers": { "Authorization": "Bearer ${PLOCA_TOKEN}" } } } }
```
`PLOCA_TOKEN` je u okolini (ne u repozitoriju). Lokalno: `http://localhost:8787/mcp` uz `npm run dev`.

## Korak 3: dashboard
`apps/dashboard`: Worker (`/api/*`, prijava preko Cloudflare Accessa JWT-a) + statični front-end (`public/index.html` s pogledima Pregled, Zadaci, Napredak, Brojke, Konkurencija i Agenti te `kalendar.html` i `skladiste.html`, u izgledu Piccolini Playa).
Samo čovjek odobrava odluke, zadaje zadatke, upisuje tjedne i kvačice. Savjetnik bira zakupca (zaglavlje X-Tenant).
Lokalno: `apps/dashboard/.dev.vars` s `DEV_USER=tvoj@email` (nikad u produkciji), pa
`npx wrangler dev --config apps/dashboard/wrangler.jsonc --persist-to apps/mcp/.wrangler/state`.
Korisnik: `node scripts/novi-korisnik.mjs <email> vlasnik <zakupac>`. Deploy i Access: `docs/DEPLOY-CLOUDFLARE.md`.

## Korak 4: izvršitelj
`apps/izvrsitelj`: Queue (jedan posao istodobno, bez automatskog ponavljanja) + Cron + petlja agenta nad Claude API-jem
(`@anthropic-ai/sdk`), alati ploče kroz MCP (service binding), web pretraga/dohvat kao server alati. Definicije agenata su u
`packages/agenti/*.md`. Trošak po pokretanju u `pokretanja`, mjesečni limit po zakupcu u `tenants.postavke_json` (`limit_usd`).
Lokalni test bez troška: `npm test -- <mapa-s-izvozom>` (lažni Claude API u `scripts/fake-anthropic.mjs`). Deploy: `docs/DEPLOY-CLOUDFLARE.md` § 8.

## Korak 6: svi agenti
`packages/agenti`: konkurencija, seo, ai, sadrzaj, lokalno, oglasi (Faza 3, ne ulazi u lanac), koordinator. Pregledi: tjedni (konkurencija → koordinator),
mjesečni (konkurencija → seo → ai → sadrzaj → lokalno → koordinator). Registri (Markdown) u tablici `registri` s dozvolama po agentu
(`apps/mcp/src/alati-pisanje.js`, `REGISTRI_DOZVOLE`), uvoz iz repozitorija klijenta: `scripts/uvoz-registara.mjs`.
