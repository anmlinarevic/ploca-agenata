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
node scripts/novi-korisnik.mjs <tvoj-email> vlasnik piccolini > tenants/piccolini/token-korisnik.sql
npx wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --file=tenants/piccolini/token-korisnik.sql
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

## 8. Izvršitelj agenata (korak 4)

**Redoslijed je bitan:** dashboard ima service binding na izvršitelja, a izvršitelj na MCP, pa deploy ide
MCP → izvršitelj → dashboard (obrnuto deploy javlja da servis ne postoji). Migracija `0003` prvo.

```
npx wrangler d1 migrations apply ploca --remote --config apps/mcp/wrangler.jsonc
npx wrangler queues create ploca-pokretanja
```

### Ključ za Claude API
Napravi ključ na console.anthropic.com (API keys) i postavi **mjesečni limit potrošnje na računu** (Billing → Limits)
kao drugu, neovisnu zaštitu uz naš limit u bazi. Ključ je tvoj trošak, ne dio pretplate.

### Tajne (tri secreta na izvršitelju)
Prvi deploy izvršitelja mora postojati prije secreta:
```
npx wrangler deploy --config apps/izvrsitelj/wrangler.jsonc
npx wrangler secret put ANTHROPIC_API_KEY --config apps/izvrsitelj/wrangler.jsonc
npx wrangler secret put INTERNI_KLJUC --config apps/izvrsitelj/wrangler.jsonc
npx wrangler secret put AGENT_TOKENS --config apps/izvrsitelj/wrangler.jsonc
```
- `INTERNI_KLJUC`: dugačak nasumičan niz (npr. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`),
  **ista vrijednost** i na dashboardu (`npx wrangler secret put INTERNI_KLJUC --config apps/dashboard/wrangler.jsonc`).
- `AGENT_TOKENS`: JSON s tokenima agenata po zakupcu. Tokene izdaješ kao u koraku 7 (sa stvarnim `TOKEN_PEPPER`), po jedan
  za `koordinator` i `konkurencija`, i upisuješ hasheve u bazu (`d1 execute --remote`). Vrijednost secreta:
  `{"piccolini":{"koordinator":"pl_...","konkurencija":"pl_..."}}` (u jednom retku).

### Dashboard (zadnji)
```
npx wrangler deploy --config apps/dashboard/wrangler.jsonc
```

### Limit potrošnje i raspored
Zadani limit je 20 USD mjesečno po zakupcu, a raspored (ponedjeljak 06:00 UTC) je **isključen** dok ga ne uključiš:
```
UPDATE tenants SET postavke_json = '{"limit_usd": 20, "raspored": true}' WHERE id = 'piccolini';
```
(`npx wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --command "..."` ili datoteka s `--file`.)
Ručno pokretanje (gumb „Pokreni sada” i „Pokreni tjedni pregled sada”) radi bez rasporeda.

### Provjeri prije oslanjanja na brojke
- Cijene u `apps/izvrsitelj/wrangler.jsonc` (`vars`) su procjena za model `claude-sonnet-5-5` i cijenu web pretrage po upitu
  (`CENA_PRETRAGA`). Usporedi s računom na console.anthropic.com nakon prvog tjedna i ispravi.
- Izvršitelj ne zna za odbijanja koja model rješava rezervnim modelom (fallback): odbijen zahtjev završava kao greška u pokretanju.
- Agenti `seo`, `ai`, `sadrzaj`, `lokalno`, `oglasi` i `materijal` još nemaju definiciju; zadatak za njih se ne pokreće gumbom,
  nego ga preuzima koordinator. Danas rade `konkurencija` i `koordinator` (tjedni pregled).
