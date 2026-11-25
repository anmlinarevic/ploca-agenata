# Spajanje Instagrama i Facebook stranice (Meta)

Ploča samo čita brojke vlastite stranice i Instagram računa. Ne objavljuje, ne čita poruke ni komentare.
Token upisuješ ti, u svom terminalu. Ne šalješ ga nikome, ni u chat.

## 1. Provjeri račune

- Instagram mora biti **profesionalni** (poslovni ili kreatorski) račun:
  Instagram → Postavke → Vrsta računa i alati.
- Instagram mora biti **povezan s Facebook stranicom**: Meta Business Suite → Postavke → Poslovna imovina,
  ili na stranici: Postavke → Povezani računi → Instagram.
- Stranica i Instagram trebaju biti u tvom **poslovnom portfelju** (business.facebook.com).

## 2. Napravi Meta aplikaciju

1. Otvori developers.facebook.com → **Moje aplikacije** → **Izradi aplikaciju**.
2. Slučaj upotrebe: **Ostalo**, vrsta: **Poslovna** (Business).
3. Naziv npr. „Ploča Piccolini”, poveži je sa svojim poslovnim portfeljem.
4. Aplikacija može ostati neobjavljena (razvojni način). Za vlastite račune ne treba Metin pregled aplikacije.

## 3. Napravi token koji ne istječe (system user)

1. business.facebook.com/settings → **Korisnici** → **Korisnici sustava** → **Dodaj**.
   Ime npr. „ploca”, uloga **Zaposlenik** je dovoljna.
2. Kod tog korisnika: **Dodijeli imovinu**:
   - Facebook stranica: dovoljno je pravo za uvide (statistiku); puna kontrola nije potrebna.
   - Instagram račun: pravo za uvide.
   - Aplikacija „Ploča Piccolini”.
3. **Generiraj novi token**, odaberi aplikaciju, rok trajanja **Nikad**, i označi dozvole:
   `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`, `business_management`.
4. Kopiraj token. Meta ga pokazuje samo jednom.

(Druga mogućnost: Graph API Explorer → dugotrajni korisnički token → `/me/accounts` → token stranice. Token stranice
dobiven iz dugotrajnog korisničkog tokena također ne istječe, ali ima više koraka.)

## 4. Id Facebook stranice

Facebook stranica → **O stranici** → **Transparentnost stranice** → ID stranice.
Ili Meta Business Suite → Postavke → Poslovna imovina → Stranice.

## 5. Upiši tajne i objavi ploču

U mapi `ploca-agenata`, redom:

```
git pull
npx wrangler d1 migrations apply ploca --remote --config apps/dashboard/wrangler.jsonc
npx wrangler secret put META_TOKEN --config apps/dashboard/wrangler.jsonc
npx wrangler secret put META_STRANICA --config apps/dashboard/wrangler.jsonc
npx wrangler deploy --config apps/dashboard/wrangler.jsonc
```

Na upit „Enter a secret value” zalijepiš token, odnosno upišeš id stranice. Imena `META_TOKEN` i `META_STRANICA`
ostaju kako jesu.

Zatim na ploči otvori **Mreže** i klikni **Osvježi s Instagrama i Facebooka**. Dalje se osvježava samo svakih 6 sati.

## Ako nešto ne radi

Poruka se vidi na Mrežama ispod naslova:

- „Meta ne prihvaća token”: token je istekao ili je opozvan. Napravi novi (korak 3) i ponovno upiši `META_TOKEN`.
- „Tokenu nedostaje dozvola”: u koraku 3 nije označena neka dozvola ili imovina nije dodijeljena korisniku sustava.
- „Meta ne nalazi tu Facebook stranicu”: krivi id u `META_STRANICA`.
- „Facebook stranica nema povezan Instagram”: korak 1.
- Neke brojke Meta daje tek od **100 pratitelja** (uvidi stranice, demografija). Do tada su ta polja prazna.
