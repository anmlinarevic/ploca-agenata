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
