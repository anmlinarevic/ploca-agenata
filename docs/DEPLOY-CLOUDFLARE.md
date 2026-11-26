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

## 9. Svi agenti i mjesečni pregled (ažuriranje nakon koraka 8)

Dodano: agenti `seo`, `ai`, `sadrzaj`, `lokalno` i `oglasi`, registri (ključne riječi, AI test, partneri, dnevnik odluka, plan sadržaja)
i mjesečni pregled (1. u mjesecu). Redoslijed: MCP → izvršitelj → dashboard; migracija prva.

```
npx wrangler d1 migrations apply ploca --remote --config apps/mcp/wrangler.jsonc
```

**Uvezi registre i postojeći izvještaj iz repozitorija Tina-Obrt** (jednom; ponovni uvoz ne briše ono što su agenti dopunili):
```
node scripts/uvoz-registara.mjs C:\Users\AnteMlinarevic\tina-obrt\docs\marketing tenants/piccolini/registri.sql
npx wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --file=tenants/piccolini/registri.sql
```
(`docs/marketing` mora biti ažurna kopija iz grane s registrima: `kljucne-rijeci.md`, `ai-vidljivost.md`, `partneri.md`,
`dnevnik-odluka.md`, `sadrzaj/2026-12-plan.md`, `sadrzaj/recenzije-predlosci.md`.)

**Tokeni za sve agente.** Ponovi skriptu iz koraka 8 s dužim popisom agenata (stari tokeni ostaju valjani, ovo izdaje nove):

```
cd C:\Users\AnteMlinarevic\ploca-agenata
$env:TOKEN_PEPPER = Read-Host "Zalijepi TOKEN_PEPPER"
$tok = @{}
foreach ($a in 'koordinator','konkurencija','seo','ai','sadrzaj','lokalno') {
  $izlaz = node scripts/novi-token.mjs piccolini $a zadano "tenants/piccolini/token-izvrsitelj-$a.sql"
  $tok[$a] = [regex]::Match(($izlaz -join "`n"), 'pl_\S+').Value
  npx wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --file="tenants/piccolini/token-izvrsitelj-$a.sql"
}
$json = @{ piccolini = $tok } | ConvertTo-Json -Compress
$json | npx wrangler secret put AGENT_TOKENS --config apps/izvrsitelj/wrangler.jsonc
Remove-Item Env:TOKEN_PEPPER
```

Agent `oglasi` nema token jer je Faza 3 (ožujak 2027.); do tada ga ne uključuj u lanac. Tada ga dodaš u petlju i u `LANCI.mjesecni`.

**Deploy:**
```
npx wrangler deploy --config apps/mcp/wrangler.jsonc
npx wrangler deploy --config apps/izvrsitelj/wrangler.jsonc
npx wrangler deploy --config apps/dashboard/wrangler.jsonc
```

**Prvi mjesečni pregled ručno**, prije nego uključiš raspored: u ploči sekcija „Agenti” → „Pokreni mjesečni pregled sada”. Šest agenata radi
jedan za drugim, a konkurencija i lokalno pretražuju web, pa je trošak veći od tjednog (procjena: nekoliko puta, nikako ne 20 USD; pogledaj
stvarni iznos u ploči i na console.anthropic.com). Raspored (ponedjeljak tjedni, 1. u mjesecu mjesečni) uključuješ SQL-om iz koraka 8.

**Što agenti ne mogu (po dizajnu izvršitelja):** nemaju datoteke repozitorija. Stranicu čitaju preko javnog weba, a promjene stranice
predlažu kao tekst u izvještaju i odluci; PR-ove i dalje radi Claude Code. AI agent ne pita ChatGPT i druge asistente: obrađuje samo
rezultate koje vlasnik upiše u registar `ai-vidljivost`.

## 10. Narudžbe, kalendar i skladište (faza B)

Novo: tablice `narudzbe`, `skladiste_kretanja`, `artikli` i `norme` (migracija `0005`), zasloni `/kalendar.html` i `/skladiste.html`
te alati `dohvati_kalendar`, `dohvati_narudzbe` i `dohvati_skladiste` na MCP-u. Ne treba novi secret.

```
cd C:\Users\AnteMlinarevic\ploca-agenata
npx wrangler d1 migrations apply ploca --remote --config apps/mcp/wrangler.jsonc
node scripts/uvoz-artikala.mjs piccolini <put/do/Tina-Obrt>\podaci\dezeni.json tenants/piccolini/artikli.sql
npx wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --file=tenants/piccolini/artikli.sql
npx wrangler deploy --config apps/mcp/wrangler.jsonc
npx wrangler deploy --config apps/dashboard/wrangler.jsonc
```

`dezeni.json` mora biti iz grane na kojoj je popis tkanina (41 tkanina; 23. 11. 2026. je u grani `claude/nova-sesija-prompt-fbe1b5`,
ne u glavnoj mapi). Kad dodaš tkaninu na stranicu, ponovi uvoz: postojeće stanje i pragovi ostaju, mijenjaju se samo naziv, boja i izvor.

**Prvi koraci na ploči:**
1. Skladište → za svaku tkaninu koju imaš „Inventura: izmjereno stanje” u m² (ili „Ulaz” u metrima s bale). Bez toga piše „Nije upisano”.
2. Isto za špagu, traku, perle, mašnice, punilo i BoxNow kutije.
3. Norme: slovo je 15 × 15 cm. Šav, slojevi, iskoristivost, traka po petlji, punilo i sati su procjena; ispravi ih kad izmjeriš.
4. Kalendar → „+ Narudžba ili rezervacija”. Kad narudžbu označiš „U izradi”, materijal se sam skida sa skladišta.

**Lokalni pregled s izmišljenim podacima:** `npm run demo -- <put/do/dezeni.json>`, pa otvori http://localhost:8797/kalendar.html.

## 11. Koordinator kao jedini sugovornik (razgovor na ploči)

Novo: vlasnik piše samo koordinatoru (gumb „Koordinator” na svakoj stranici). Koordinator (Claude Opus 5.5) bira agenta,
daje mu zadatak alatom `zadaj_zadatak`, a izvršitelj taj zadatak pokreće sam čim koordinator završi. Kad agent završi, obavijest
stiže u razgovor. Odobrena odluka odmah ide koordinatoru. Ako posao ne može nijedan agent (npr. izmjena stranice bez GitHub
pristupa), koordinator to zapiše kao „Čeka tebe” ili kao zahtjev za pristup (`zatrazi_pristup`).

Migracija `0009` (tablice `razgovor` i `pristupi`, nova polja na zadacima, odlukama i pokretanjima). Ne treba novi secret: koordinator
s tokenom `*` vidi nove alate sam. Redoslijed kao i prije, MCP → izvršitelj → dashboard:

```
cd C:\Users\AnteMlinarevic\ploca-agenata
npx wrangler d1 migrations apply ploca --remote --config apps/mcp/wrangler.jsonc
npx wrangler deploy --config apps/mcp/wrangler.jsonc
npx wrangler deploy --config apps/izvrsitelj/wrangler.jsonc
npx wrangler deploy --config apps/dashboard/wrangler.jsonc
```

**Trošak:** jedna poruka koordinatoru je okvirno 0,05 do 0,15 USD (Opus), plus agent kojem da posao (Sonnet, kao i do sada).
Mjesečni limit vrijedi za sve. Model i effort koordinatora mijenjaju se varijablama `MODEL_KOORDINATOR` i `EFFORT_KOORDINATOR`
u `apps/izvrsitelj/wrangler.jsonc`; `FALLBACKS=ne` isključuje rezervni model kad glavni odbije zahtjev.

**Stare odluke:** odobrene odluke bez zadatka (prije ove verzije) stoje pod „Čeka tebe” kao „Nije raspoređeno”; gumb
„Daj koordinatoru” ih šalje koordinatoru. Odluke koje su čekale „izradu u Claude Codeu” migracija označi kao „Čeka tebe”.

**Diktiranje (dopuna):** dashboard ima binding `AI` (Workers AI, Whisper) za `/api/diktat`. Ne treba secret ni ključ; dovoljan je
`npx wrangler deploy --config apps/dashboard/wrangler.jsonc`. Trošak je oko 0,0005 USD po minuti govora i ulazi u Cloudflareov račun
(besplatna dnevna kvota Workers AI to obično pokrije). Zvuk se ne sprema; u `audit_log` ide samo trajanje i broj znakova.
