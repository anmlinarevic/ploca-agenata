# Spajanje Google Search Consolea (stranica Web)

Ploča samo čita Search Console: klikove, upite, pozicije, sitemape i je li stranica u Googleovom indeksu.
Ne šalje sitemape, ne traži indeksiranje i ne mijenja postavke. Za to koristi poseban **servisni račun** Googlea
s dopuštenjem „Ograničeno”. Ključ tog računa upisuješ ti, u svom terminalu. Ne šalješ ga nikome, ni u chat.

Treba ti oko 15 minuta. Koraci 1 i 2 rade se samo jednom.

## 1. Svojstvo u Search Consoleu (ako ga još nemaš)

1. Otvori search.google.com/search-console → **Dodaj svojstvo** → **Domena** → upiši `piccoliniplay.hr`.
2. Google traži TXT zapis u DNS-u. Domena je na Cloudflareu, pa imaš dvije mogućnosti:
   - Google nudi **automatsku potvrdu preko Cloudflarea**: prijaviš se u Cloudflare i odobriš.
   - Ili ručno: Cloudflare → piccoliniplay.hr → **DNS** → **Records** → **Add record**, vrsta **TXT**, ime `@`,
     sadržaj `google-site-verification=…` (kopiraš iz Googlea). Spremi pa u Googleu klikni **Potvrdi**.
     Potvrda zna potrajati nekoliko minuta.
3. U Search Consoleu: **Sitemapi** → upiši `https://www.piccoliniplay.hr/sitemap.xml` → **Pošalji**.

Prve brojke Google pokazuje tek nakon 2–3 dana. Ploča se može spojiti odmah; prazne tablice se popune same.

## 2. Google Cloud projekt i servisni račun

1. Otvori console.cloud.google.com (isti Google račun kao Search Console je najjednostavnije).
   Gore lijevo: izbor projekta → **Novi projekt**, ime npr. `ploca-piccolini` → **Izradi**.
2. **APIs & Services** → **Library** → potraži **Google Search Console API** → **Enable**.
3. **IAM & Admin** → **Service Accounts** → **Create service account**. Ime `ploca`. Uloge (roles) **ne trebaju**:
   preskoči korake 2 i 3 i klikni **Done**.
4. Klikni novi račun → kartica **Keys** → **Add key** → **Create new key** → **JSON** → **Create**.
   Preuzme se datoteka, npr. `ploca-piccolini-1a2b3c.json`. To je ključ: čuvaj ga kao lozinku.
5. Prepiši **e-mail servisnog računa** (oblik `ploca@ploca-piccolini.iam.gserviceaccount.com`). On nije tajna.

## 3. Daj servisnom računu pravo čitanja

Search Console → svojstvo `piccoliniplay.hr` → **Postavke** → **Korisnici i dopuštenja** → **Dodaj korisnika**:
e-mail servisnog računa iz koraka 2.5, dopuštenje **Ograničeno** → **Dodaj**.

## 4. Upiši tajne i objavi ploču

U PowerShellu, u mapi `ploca-agenata`, redom (putanju do ključa prilagodi):

```powershell
git pull
```

```powershell
npx wrangler d1 migrations apply ploca --remote --config apps/dashboard/wrangler.jsonc
```

```powershell
Get-Content "$HOME\Downloads\ploca-piccolini-1a2b3c.json" -Raw | npx wrangler secret put GSC_KLJUC --config apps/dashboard/wrangler.jsonc
```

```powershell
npx wrangler secret put GSC_SVOJSTVO --config apps/dashboard/wrangler.jsonc
```

Na upit „Enter a secret value” upiši `sc-domain:piccoliniplay.hr`. (Ako si u koraku 1 dodao svojstvo s prefiksom URL-a,
upiši točnu adresu, npr. `https://www.piccoliniplay.hr/`.)

```powershell
npx wrangler deploy --config apps/dashboard/wrangler.jsonc
```

Zatim **obriši preuzetu JSON datoteku** iz Preuzimanja; ključ je sada samo u Cloudflareu. Ako ikad zatreba novi,
napraviš ga u koraku 2.4 i stari obrišeš.

Na ploči otvori **Web** i klikni **Osvježi iz Search Consolea**. Dalje se osvježava samo, jednom dnevno.

## Ako nešto ne radi

Poruka se vidi na stranici Web ispod naslova, i u **Izvori i pravila**:

- „Servisni račun nema pristup svojstvu …”: korak 3 (točan e-mail, dopuštenje Ograničeno), ili `GSC_SVOJSTVO` ne odgovara
  svojstvu (domena `sc-domain:…` naspram prefiksa `https://…/`).
- „Search Console ne nalazi svojstvo …”: krivo upisan `GSC_SVOJSTVO`.
- „… nije uključen Google Search Console API”: korak 2.2, u istom projektu u kojem je servisni račun.
- „Google ne prihvaća ključ servisnog računa”: ključ je obrisan ili pogrešno zalijepljen. Napravi novi (2.4) i ponovi upis `GSC_KLJUC`.
- „GSC_KLJUC nije ispravan JSON”: upisan je samo dio datoteke. Koristi naredbu s `Get-Content … -Raw` iznad.
- „Svojstvo … još nije potvrđeno”: korak 1.2 nije dovršen.
- Tablice su prazne, a greške nema: Google još nema podataka (novo svojstvo) ili stranica još nema pojavljivanja.
