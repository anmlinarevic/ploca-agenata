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
`apps/dashboard`: Worker (`/api/*`, prijava preko Cloudflare Accessa JWT-a) + statični front-end (`public/index.html` s početnom „Poslovno” (odjeli), Odlukama, Zadacima i pogledima marketinga te `kalendar.html`, `skladiste.html` i `mreze.html`, u izgledu Piccolini Playa).
Samo čovjek odobrava odluke, upisuje tjedne i kvačice; posao zadaje porukom koordinatoru. Savjetnik bira zakupca (zaglavlje X-Tenant).
Lokalno: `apps/dashboard/.dev.vars` s `DEV_USER=tvoj@email` (nikad u produkciji), pa
`npx wrangler dev --config apps/dashboard/wrangler.jsonc --persist-to apps/mcp/.wrangler/state`.
Korisnik: `node scripts/novi-korisnik.mjs <email> vlasnik <zakupac>`. Deploy i Access: `docs/DEPLOY-CLOUDFLARE.md`.

### Ploča tvrtke (navigacija po odjelima)
Sve stranice dijele bočnu navigaciju (`public/ploca.js`): **Pregled** (uprava, `/#pregled`), odjeli **Prodaja** (`prodaja.html`),
**Proizvodnja** (`skladiste.html`), **Mreže i marketing** (`mreze.html`), **Financije** (`financije.html`), **Web** (`web.html`) te
zajednički **Kalendar**, **Svi zadaci** (`/#svi`), **Agenti** (`/#agenti`) i **Izvori i pravila** (`izvori.html`).
Pregled spaja stvarne brojke: prihod i naplata iz Parre (`GET /api/financije`, `packages/poslovanje/financije.js`), kalendar i skladište,
Meta, odluke i zadatke („Čeka tebe”), pokretanja agenata i potrošnju po agentu (`/api/stanje` → `potrosnja.poAgentu`).
Popis agenata i odjela za koje rade je u `ploca.js` (`PL.AGENTI`). Prototip izgleda: `tina-obrt/docs/marketing/ploca/prototip/ploca-tvrtke.html`.

### Koordinator (razgovor na ploči)
Vlasnik piše samo koordinatoru: gumb „Koordinator” na svakoj stranici (`ploca.js`), `GET/POST /api/razgovor`. Koordinator (Opus) bira agenta
i daje mu zadatak (`zadaj_zadatak`, MCP); izvršitelj zadatke s `automatski = 1` pokreće čim koordinator završi, a kad agent završi,
obavijest ide u razgovor i odobrena odluka se zatvara. Odobrena odluka odmah ide koordinatoru (`/odluka` na izvršitelju). Što nitko ne može,
koordinator zapisuje kao `ceka_tebe` na odluci ili kao zahtjev za pristup (`zatrazi_pristup`, tablica `pristupi`). Migracija 0009.
Na ploči svako stanje kaže tko je na potezu: ti, koordinator ili agent.
Diktiranje: preglednik snimi govor, pretvori ga u WAV (16 kHz, mono) i pošalje na `POST /api/diktat`; tekst vraća Whisper
(`@cf/openai/whisper-large-v3-turbo`, Workers AI, binding `AI` na dashboardu, oko 0,0005 USD po minuti, zvuk se ne sprema).
Ne ovisi o ugrađenom prepoznavanju govora u pregledniku. Lokalni `wrangler dev` dashboarda zato zove Cloudflare (treba `wrangler login`).

### Parra (ponude → kalendar)
Dashboard svakih 30 minuta (cron) i na gumb „Osvježi iz Parre” čita ponude i uplate iz Parre (`packages/poslovanje/parra.js`, API v1.1, samo GET).
Datum isporuke ponude ide u kalendar: poslana → prihvaćena (datum rezerviran) → račun izdan → plaćeno. Odbijene i istekle se ne prikazuju.
Na ploču ne ulaze ime kupca, OIB, adresa, kontakt ni opisi stavki. Tablice: `parra_ponude`, `parra_sinkronizacija` (migracija 0006).
Ključ i id poslovnog subjekta su tajne; upisuje ih vlasnik u svom terminalu (vrijednost se ne vidi ni u repozitoriju ni u nadzornoj ploči):
`npx wrangler secret put PARRA_API_KLJUC --config apps/dashboard/wrangler.jsonc` i `npx wrangler secret put PARRA_SUBJEKT --config apps/dashboard/wrangler.jsonc`.
Lokalni test: lažni Parra u `scripts/fake-parra.mjs` (ključ `test-parra`, subjekt 123), testovi u `scripts/parra-test.mjs`.

### Meta (Instagram i Facebook stranica → Mreže)
Dashboard svakih 6 sati (cron `15 */6 * * *`) i na gumb na Mrežama čita vlastitu Facebook stranicu i povezani Instagram
poslovni račun (`packages/poslovanje/meta.js`, Graph API v25.0, samo GET, token u zaglavlju): pratitelji po danu, doseg i
pregledi za 28 dana (i prethodnih 28), objave s pregledima, dosegom, spremanjima i dijeljenjima. Ekran računa zadnjih 5
naspram prethodnih 5 objava, najbolji dan i sat objave te uvide (reelsi naspram fotografija, najviše spremanja).
Ploča ne čita poruke ni komentare; opis objave skraćen je na 90 znakova bez @oznaka i brojeva telefona.
Tablice: `racuni` (jedan red po Facebook stranici, Instagram i TikTok računu; migracija 0011), `brojke_dan` (dnevne brojke po računu), `meta_razdoblje` i `meta_objave` (po računu). `meta_pratitelji` i `meta_sinkronizacija` su zastarjele i više se ne koriste.
Računi: `GET/POST /api/racuni`, `DELETE /api/racuni/:id`. Meta token (korisnik sustava) vrijedi za sve stranice koje mu je dodijeljena imovina; `META_STRANICA` se čita samo za prijelaz sa stare postavke. Test: `npm run test:racuni` (bez wranglera).
Tajne upisuje vlasnik: `npx wrangler secret put META_TOKEN --config apps/dashboard/wrangler.jsonc` (token stranice ili
system usera s dozvolama instagram_basic, instagram_manage_insights, pages_read_engagement, read_insights, pages_show_list)
i `npx wrangler secret put META_STRANICA --config apps/dashboard/wrangler.jsonc` (id Facebook stranice). Upute korak po korak:
`docs/META-SPAJANJE.md`. Lokalni test: `scripts/fake-meta.mjs` (token `test-meta`, stranica 555), testovi u `scripts/meta-test.mjs`.

### Google Search Console (→ Web)
Dashboard jednom dnevno (jedan krug crona `*/30` umjesto Parre, da ne dijele ograničenje od 50 podzahtjeva) i na gumb na
stranici Web čita Search Console (`packages/poslovanje/gsc.js`) servisnim računom: JWT potpisan ključem u Workeru (WebCrypto,
RS256), opseg `webmasters.readonly`, račun u Search Consoleu s dopuštenjem „Ograničeno”. Čita klikove, pojavljivanja, CTR i
poziciju za 28 + 28 dana, klikove po danu (cijeli mjeseci idu i u `mjesecno.gsc_*`), najbolje upite, stranice i zemlje, poslane
sitemape te je li svaka adresa iz sitemapa u indeksu (URL Inspection, jednom u 20 sati po adresi). Ništa ne šalje ni ne mijenja.
Tablice: `gsc_dani`, `gsc_razdoblje`, `gsc_stavke`, `gsc_sitemapi`, `gsc_url`, `gsc_sinkronizacija` (migracija 0008).
Tajne: `GSC_KLJUC` (cijela JSON datoteka ključa) i `GSC_SVOJSTVO` (npr. `sc-domain:piccoliniplay.hr`). Upute: `docs/GSC-SPAJANJE.md`.
Lokalni test: `scripts/fake-gsc.mjs` (provjerava potpis JWT-a testnim javnim ključem), testovi u `scripts/gsc-test.mjs`.

## Korak 4: izvršitelj
`apps/izvrsitelj`: Queue (jedan posao istodobno, bez automatskog ponavljanja) + Cron + petlja agenta nad Claude API-jem
(`@anthropic-ai/sdk`), alati ploče kroz MCP (service binding), web pretraga/dohvat kao server alati. Definicije agenata su u
`packages/agenti/*.md`. Trošak po pokretanju u `pokretanja`, mjesečni limit po zakupcu u `tenants.postavke_json` (`limit_usd`).
Lokalni test bez troška: `npm test -- <mapa-s-izvozom>` (lažni Claude API u `scripts/fake-anthropic.mjs`). Deploy: `docs/DEPLOY-CLOUDFLARE.md` § 8.

## Korak 6: svi agenti
`packages/agenti`: konkurencija, seo, ai, sadrzaj, lokalno, oglasi (Faza 3, ne ulazi u lanac), koordinator. Pregledi: tjedni (konkurencija → koordinator),
mjesečni (konkurencija → seo → ai → sadrzaj → lokalno → koordinator). Registri (Markdown) u tablici `registri` s dozvolama po agentu
(`apps/mcp/src/alati-pisanje.js`, `REGISTRI_DOZVOLE`), uvoz iz repozitorija klijenta: `scripts/uvoz-registara.mjs`.
