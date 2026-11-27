# Stanje: računi na mrežama i razdoblje na cijeloj ploči

Grana: `claude/mreze-racuni-razdoblja`. Ništa nije u mainu ni na produkciji. Migracija 0011 nije primijenjena ni na jednoj stvarnoj bazi.
Dokument se dopunjuje kako posao napreduje; na dnu je popis onoga što fali.

## Gotovo i provjereno
| Dio | Što je | Kako je provjereno |
|---|---|---|
| Računi u bazi | migracija 0011 (`racuni`, `brojke_dan`, `racun_id` u `meta_objave` i `meta_razdoblje`), postojeći podaci prelaze na račune | `npm run test:racuni` (40 provjera, prave migracije na SQLite) |
| Sinkronizacija Mete po računu | svaka stranica zasebno, greška jedne ne zaustavlja ostale, uklonjeni račun se ne vraća zbog stare tajne | `test:racuni` + lažna Meta |
| API računa | `GET/POST /api/racuni`, `DELETE /api/racuni/:id`, `POST /api/meta/osvjezi {racun}` | `test:racuni` + preglednik |
| Stranica Mreže | tabovi Sve mreže / Facebook / Instagram / TikTok, odabir računa, dodavanje i uklanjanje | preglednik protiv lokalne baze i lažne Mete |
| Filter razdoblja (komponenta) | `public/razdoblje.js`, isti izbor na svim ekranima, svaki ekran nudi samo razdoblja koja podaci podržavaju | preglednik |
| Financije po razdoblju | `GET /api/financije?mjeseci=N` ili `od/do`, usporedba s prethodnim | `npm run test:financije` (24) + preglednik |
| Objave po računu | migracija 0012 (`racun_id`, `grupa_id`), `predlozi_objavu`/`azuriraj_objavu` primaju račun, novi alat `dohvati_racune`, filter po računu i oznaka računa na stranici Objave, veza s Mreža | `npm run test:objave-racuni` (23) + preglednik |
| Web po razdoblju | dnevne brojke Search Consolea godinu dana (prije 120 dana), `GET /api/web?dana|od&do`, popisi upita/stranica/zemalja za razdoblje iz Googlea s predmemorijom 12 h (migracija 0013), usporedba samo kad je prethodno razdoblje cijelo u povijesti | `npm run test:web` (31, lažni Google s pravim RS256 potpisom) + preglednik s postojećim `fake-gsc` |
| Knjižnica | uz svaki materijal gdje je korišten po računima (`koristenjeMaterijala`), „Napravi objavu iz ovoga” za izabrane račune šalje zahtjev koordinatoru | `test:objave-racuni` + preglednik (koordinator se lokalno ne pokreće) |
| Mreže po razdoblju | dnevni pregledi i doseg po računu u komadima od 30 dana do godine dana (migracija 0014), `GET /api/mreze?dana|od&do`, KPI-jevi i graf kroz vrijeme po računu, tablica računa za razdoblje, razlog kad Meta metriku ne daje | `npm run test:mreze` (30, lažna Meta s nizovima po danu) + preglednik. **Pozivi prema pravoj Meti nisu provjereni** |
| Prodaja i Pregled po razdoblju | `GET /api/prodaja`, upiti po izvoru, cijeli tjedni, usporedba, lijevak na Pregledu | `npm run test:prodaja` (30) + preglednik |

## Što fali (dopunjava se niže)

### 1. Treba pokrenuti kod vas prije spajanja u main
- `npm test` i `meta-test` (traže izvoz stare ploče i pokrenuti wrangler; ovdje nisu mogli raditi). Promjene diraju `meta.js`, `/api/mreze`, `/api/web`, `/api/financije`, objave i MCP alate, pa te testove treba proći.
- **Migracije 0011 do 0014** nisu primijenjene ni na jednoj stvarnoj bazi. 0011 i 0012 prebacuju postojeće podatke (provjereno na SQLite-u s lažnim starim podacima). Preporuka: prije primjene na produkciji napraviti izvoz baze (`wrangler d1 export`).
- `apps/dashboard/wrangler.jsonc` nije mijenjan; ništa novo ne traži tajne. Meta token ostaje isti.

### 2. Nije provjereno protiv prave Mete (samo lažna Meta)
- Dnevni nizovi (`period=day`) za preglede i doseg, na Instagramu i Facebooku, i pripadnost dana (`end_time`). Vidi `docs/META-SPAJANJE.md`.
- Koliko Meta stvarno daje unazad i koje metrike. Ako `views` nije dostupan kao dnevni niz, Mreže će za preglede pokazivati razlog, a ne brojke.
- Povijest **pratitelja** za dulja razdoblja: ne postoji (Instagram daje 30 dana); rast se broji od prvog osvježavanja.

### 3. Nije napravljeno
- **TikTok brojke.** Računi se samo evidentiraju. Nedostaje uvoz CSV-a iz TikTok Studija (nepoznat točan format izvoza, pa ga nisam pogađao) i kasnije TikTok API (traži odobrenu aplikaciju). Dok toga nema, tab TikTok ne pokazuje brojke ni razdoblje.
- **Objave po računu za TikTok „Preuzmi video”/objavu** radi kao prije (ručno); nema veze s TikTok API-jem.
- **Pregled (uprava)**: osim lijevka „Od mreža do novca” ostali dijelovi nemaju filter jer ne prikazuju povijest.
- **Doseg u lijevku** na Pregledu pokazuje „–” dok dnevne brojke dosega ne pokriju cijelo razdoblje na svakom Meta računu (to se događa tek kad se povijest učita).
- **Plan tjedna po računu**: ostao je zajednički za sve mreže (preporuka iz prijedloga); nije dijeljen po računima.
- **Knjižnica**: „Napravi objavu” samo šalje poruku koordinatoru; ne stvara zadatak izravno. Nema filtra knjižnice po računu.
- **Sinkronizacija TikTok računa**, **OAuth prijava** za TikTok i **uvoz povijesti iz Parre starije od onoga što je već u bazi** nisu rađeni.
- Upiti (Prodaja) se i dalje upisuju ručno tjedno; za razdoblja kraća od 28 dana nema podataka (zato ih Prodaja i Pregled ne nude).
- Search Console: popisi upita/stranica/zemalja za razdoblje traže Google pri otvaranju ekrana (do 7 zahtjeva), pa je prvi prikaz novog razdoblja sporiji; rezultat se 12 sati pamti.
- Nijedan prikaz nije probno otvoren na mobitelu osim uobičajene provjere da nema vodoravnog skrolanja (390 px).

### 4. Poznate sitnice
- Ime računa koje Meta vrati dolazi kao `@korisnicko.ime` (Instagram) ili naziv stranice; ako ga vlasnik upiše ručno, Meta ga više ne prepisuje.
- Uklonjen račun ostaje u bazi (neaktivan) i ne vraća se sam; da se ponovno dodaje, dodaje se kao novi.
- Lijevak na Pregledu zaokružuje razdoblje na cijele tjedne (Prodaja isto), a Financije na cijele mjesece; svaki ekran piše točno razdoblje koje je koristio.
