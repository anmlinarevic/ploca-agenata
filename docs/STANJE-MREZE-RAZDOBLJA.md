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
| Prodaja i Pregled po razdoblju | `GET /api/prodaja`, upiti po izvoru, cijeli tjedni, usporedba, lijevak na Pregledu | `npm run test:prodaja` (30) + preglednik |

## Što fali (dopunjava se niže)
