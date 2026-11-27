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
| Prodaja i Pregled po razdoblju | `GET /api/prodaja`, upiti po izvoru, cijeli tjedni, usporedba, lijevak na Pregledu | `npm run test:prodaja` (30) + preglednik |

## Što fali (dopunjava se niže)
