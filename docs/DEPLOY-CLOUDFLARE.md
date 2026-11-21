# Deploy na Cloudflare (korak po korak)

Ništa od ovoga nije napravljeno; traži tvoj Cloudflare račun. Redoslijed je bitan.
Naredbe pokreći iz korijena repozitorija `ploca-agenata`, nakon `npm install`.

## 1. Prijava
```
npx wrangler login
```

## 2. Baza (EU jurisdikcija)
```
npx wrangler d1 create ploca --jurisdiction eu
```
Ispisani `database_id` upiši u **oba** `apps/mcp/wrangler.jsonc` i `apps/dashboard/wrangler.jsonc`
(umjesto `00000000-…`). Zatim migracije na pravu bazu:
```
npx wrangler d1 migrations apply ploca --remote --config apps/mcp/wrangler.jsonc
```

## 3. Podaci i korisnici
```
node scripts/uvoz-piccolini.mjs <mapa-s-izvozom> tenants/piccolini/seed.sql
npx wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --file=tenants/piccolini/seed.sql
node scripts/novi-korisnik.mjs <tvoj-email> vlasnik piccolini > tenants/piccolini/korisnik.sql
npx wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --file=tenants/piccolini/korisnik.sql
```
Savjetnik (bez zakupca, vidi sve): `node scripts/novi-korisnik.mjs <email> savjetnik`. E-mail mora biti isti
kojim se prijavljuješ u Access.

## 4. Deploy dashboarda
```
npx wrangler deploy --config apps/dashboard/wrangler.jsonc
```
Dobiješ adresu `ploca-dashboard.<račun>.workers.dev`. **Još je otvorena dok ne uključiš Access (korak 5):**
bez ACCESS postavki API odgovara 500 („Prijava nije podešena”), dakle ne propušta nikoga. Ne postavljaj `DEV_USER`.

## 5. Domena i Cloudflare Access
1. Workers & Pages → `ploca-dashboard` → Settings → Domains & Routes → Add → Custom domain:
   `ploca.piccoliniplay.hr` (zona piccoliniplay.hr je već na Cloudflareu).
2. Zero Trust (one.dash.cloudflare.com) → prvi put traži ime tima (npr. `piccolini`); odaberi besplatni plan.
   Adresa tima je `<ime>.cloudflareaccess.com`.
3. Access → Applications → Add → Self-hosted:
   - domena: `ploca.piccoliniplay.hr`;
   - Policy: Action **Allow**, Include → Emails → tvoj e-mail (i savjetnikov);
   - Login method: One-time PIN.
4. Otvori aplikaciju → Overview → kopiraj **Application Audience (AUD) Tag**.
5. Postavi na Workeru (Settings → Variables and Secrets), tip Text:
   - `ACCESS_TEAM_DOMAIN` = `<ime>.cloudflareaccess.com`
   - `ACCESS_AUD` = kopirani AUD tag
   Ili `npx wrangler secret put ACCESS_AUD --config apps/dashboard/wrangler.jsonc`.
6. Isključi pristup preko `*.workers.dev` adrese: Worker → Settings → Domains & Routes → workers.dev → Disable.
   (Inače bi se moglo doći zaobilazno; API bi i tada tražio ispravan JWT, ali nema razloga da ostane otvoreno.)

## 6. Provjera
- Otvori `https://ploca.piccoliniplay.hr`: Access traži e-mail i jednokratni kod, zatim se vidi ploča.
- S drugog e-maila (koji nije na popisu) Access ne propušta.
- E-mail koji prođe Access, a nije u tablici `users`, dobije „Tvoj e-mail nema pristup ovoj ploči.” (403).

## 7. MCP server (korak 2) i tokeni
```
npx wrangler secret put TOKEN_PEPPER --config apps/mcp/wrangler.jsonc
npx wrangler deploy --config apps/mcp/wrangler.jsonc
TOKEN_PEPPER=<ista vrijednost> node scripts/novi-token.mjs piccolini koordinator zadano tenants/piccolini/token-koordinator.sql
npx wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --file=tenants/piccolini/token-koordinator.sql
```
`TOKEN_PEPPER` zapiši u upravitelj lozinki: bez njega se tokeni ne mogu provjeriti. MCP adresa
`https://ploca-mcp.<račun>.workers.dev/mcp` zaštićena je tokenom, a ne Accessom (agenti nemaju preglednik).
