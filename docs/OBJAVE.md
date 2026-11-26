# Objave: Claude izrađuje, vlasnik odobrava

Stanje: 26. 11. 2026. Plan: [Piccolini na TikToku](https://claude.ai/artifact/X9QXih2SCCwQczR8VR7XZK) (verzija 2).

## Kako radi

1. Claude u zakazanoj Claude Code sesiji (ponedjeljak i srijeda ujutro) napravi tjedni plan, video ili slajdove.
2. Datoteke učita u R2 preko jednokratne adrese (`zatrazi_ucitavanje`), pa pošalje plan (`predlozi_plan_tjedna`)
   i objave (`predlozi_objavu`). Sve čeka pod **Mreže i marketing → Objave** i u „Čeka tebe”.
3. Vlasnik na stranici `/objave.html` pregleda video, pa **Odobri**, **Vrati s komentarom** ili **Odbaci**.
4. Claude na početku sljedeće sesije čita vraćene objave (`dohvati_objave`) i ispravlja ih (`azuriraj_objavu`).
5. Odobrenu objavu vlasnik zasad objavi sam: **Preuzmi video**, **Kopiraj opis**, objava u TikTok aplikaciji
   (zvuk iz knjižnice, oznaka AI ako piše na kartici), pa **Označi kao objavljeno**.
6. Snimke i fotografije vlasnik učitava u **Knjižnicu materijala** (`/knjiznica.html`) s mobitela.

**Pravila koja provodi sam sustav**

- Claude nema alat za odobravanje ni objavu. Token `kreator` ima samo alate za čitanje i prijedloge.
- Materijal iz knjižnice Claude vidi i smije koristiti samo ako je označen „Smije u objave”.
- Snimka s prepoznatljivim djetetom bez pisanog pristanka ne može biti označena za objave (provjera u API-ju i
  `CHECK` u bazi).
- Odobrena objava više se ne može mijenjati. Ispravak nakon odobrenja je nova objava.
- Mediji su vidljivi samo prijavljenim korisnicima zakupca (Access), a ključevi u R2 počinju imenom zakupca.
- Ograničenja: 80 učitavanja u 24 sata, 30 novih objava u 7 dana, 95 MB po datoteci.

## Puštanje u rad (jednom)

Naredbe se pokreću iz korijena repozitorija.

```powershell
npx wrangler r2 bucket create ploca-mediji --jurisdiction eu
```

```powershell
npx wrangler d1 migrations apply ploca --remote --config apps/mcp/wrangler.jsonc
```

```powershell
npx wrangler deploy --config apps/mcp/wrangler.jsonc
```

```powershell
npx wrangler deploy --config apps/dashboard/wrangler.jsonc
```

## Token za Claudeove sesije

Token se ispiše jednom; u bazu ide samo njegov hash. `TOKEN_PEPPER` mora biti isti kao tajna na MCP workeru.

```powershell
$env:TOKEN_PEPPER = 'ISTI-KAO-NA-MCP-U'; node scripts/novi-token.mjs piccolini kreator zadano kreator.sql
```

```powershell
npx wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --file kreator.sql; Remove-Item kreator.sql
```

Token se zatim dodaje Claude Codeu kao MCP poslužitelj (lokalno ili u okruženju zakazane sesije):

```powershell
claude mcp add --transport http ploca https://ploca-mcp.<racun>.workers.dev/mcp --header "Authorization: Bearer <TOKEN>"
```

Zakazana sesija u oblaku mora smjeti otvarati adresu MCP workera (mrežne postavke okruženja). Opoziv tokena:
`UPDATE agent_tokeni SET opozvan = 1 WHERE agent = 'kreator';`

## Lokalni test

```powershell
$env:PORT_PLOCA = '8898'; $env:PORT_MCP = '8899'; node scripts/test-lokalno.mjs <mapa-s-izvozom>
```

`scripts/objave-test.mjs` prolazi cijeli tok: učitavanje u knjižnicu i preko MCP-a, pravilo o djeci, prijedlog,
vraćanje s komentarom, ispravak, odobrenje, objavljeno, premotavanje videa (Range) i izolaciju zakupca.

## Sljedeće

- Veza s TikTokom: odobrena objava sama stiže kao skica (TikTok Content Posting API, upload u sandučić).
- Nakon TikTokove revizije aplikacije: izravna objava u zakazano vrijeme, s obveznim kontrolama TikToka na ploči.
- TikTok brojke na stranici Mreže.
