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

## Više računa (od migracije 0011)

Ploča može čitati **više Facebook stranica i Instagram računa**. Isti token (korisnik sustava iz koraka 3) vrijedi za sve stranice kojima
je dodijeljena imovina: za novu stranicu u Meta Business Suiteu dodijeli stranicu (i njezin Instagram) istom korisniku sustava.

- Račun se dodaje na ploči: **Mreže, Facebook ili Instagram, „+ Dodaj račun”**, i upiše se ID Facebook stranice. Instagram se dodaje preko
  stranice na koju je povezan; njegovo korisničko ime ploča pronađe sama pri prvom osvježavanju.
- `META_STRANICA` više nije potrebna. Ako postoji, čita se samo jednom za prijelaz (prvi Facebook račun), a račun koji ukloniš ne vraća se zbog nje.
- Greška na jednoj stranici (npr. stranica nije dodijeljena korisniku sustava) vidi se uz taj račun i ne zaustavlja ostale.
- Svaki račun ima oznaku posla (banneri, igraonica, oboje).

## Dnevne brojke i povijest (od migracije 0014)

Uz svako osvježavanje ploča povlači **dnevne preglede i doseg** po računu: zadnjih 30 dana i, dok ne dođe do godine dana, do dva starija komada od
30 dana (prvi krug 90 dana, svaki idući još 60; ukupno šest krugova, oko 1,5 dana uz osvježavanje svakih 6 sati). Račun u međuvremenu piše
„dnevnih brojki ima za X od Y dana”.

**Ograničenja koja treba provjeriti protiv prave Mete** (u ovom repozitoriju su testirana samo protiv lažne Mete):
- Meta ne daje svaku metriku kao dnevni niz za svaku vrstu računa. Ako ne da (npr. `views` na Instagramu), krug uspijeva, ostale metrike ostaju, a račun
  pamti razlog (`racuni.dnevno_greska`) i ekran ga prikazuje.
- Instagram, koliko znam, daje povijest **pratitelja** samo 30 dana unazad, pa se rast pratitelja za dulja razdoblja broji od prvog osvježavanja.
- Dan na koji se odnosi dnevna vrijednost uzima se kao 24 sata prije `end_time` (kraj dana). Ako se u stvarnosti pokaže pomak za jedan dan, ispravlja se
  u jednoj funkciji (`danIzKrajaDana` u `packages/poslovanje/meta.js`).
- Doseg je po danu; za razdoblje se zbraja pa nije broj jedinstvenih osoba. Ekran to piše.
