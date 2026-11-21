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
