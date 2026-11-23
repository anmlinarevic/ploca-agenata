# Od marketinške do poslovne ploče

Stanje 23. 11. 2026.: ploča radi za marketing (6 agenata, odluke, zadaci, registri, tjedni i mjesečni pregled).
Ovaj plan je širi: ploča postaje poslovna ploča obrta, a ujedno ogledni primjer usluge koju nudimo preko
mlinarevic.eu. Zato se sve gradi po zakupcu (`tenant_id`). Piccolini je prvi zakupac, ali ništa nije zapisano
za Piccolini u kodu.

Prototip izgleda: https://claude.ai/artifact/2iTsjPg6WqLdQyoUVzvdt3 (zasloni Pregled, Zadaci, Poslovno, Kalendar,
Skladište, Društvene mreže).

## Pravila koja se ne mijenjaju

1. **Agent predlaže, čovjek odobrava.** Ništa se ne objavljuje, ne šalje, ne plaća i ne naručuje bez odobrenja.
   Agenti **ne odgovaraju** na e-mailove ni poruke. Samo čitaju i broje.
2. **Cijene se ne diraju.** Agent smije pokazati maržu ili poskupljenje materijala, ali cjenik mijenja čovjek.
3. **Bez osobnih podataka kupaca na ploči.** Kalendar i narudžbe nose šifru narudžbe i kratak opis
   („Banner LUCIJA, ruža”). Ime, adresa i telefon ostaju u Gmailu i u programu za račune. Iz poruka na ploču idu
   samo zbrojevi i anonimizirani sažeci.
4. **Svaki agent ima jedan posao i svoj token.** Token ga ograničava na njegove alate i registre (kao danas).
5. **Trošak ima strop.** Mjesečni limit po zakupcu; dnevni agenti su mali i jeftini, tjedni i mjesečni veći.

## Odjeli i agenti

Ploča se organizira po **odjelima**, a ne po popisu agenata. Svaki odjel ima svoj zaslon, a početna stranica
„Poslovno” pokazuje sve odjele s brojem stvari koje čekaju tebe.

| Odjel | Agent | Što radi | Izvor podataka | Ritam |
|---|---|---|---|---|
| **Uprava** | Voditelj (danas Koordinator) | Tjedni poslovni sažetak svih odjela, rokovi, što zapinje | ploča | tjedno, mjesečno |
| | Financije | Prihod po usluzi, trošak materijala po proizvodu, marža. Cjenik ne dira. | izvoz iz programa za račune (CSV), skladište | mjesečno |
| **Prodaja** | Upiti | Broji upite po kanalu i vrsti, prihvaćene i odbijene, vrijeme do odgovora, ocjenjuje ton naših odgovora (anonimno) | Gmail, Instagram i Facebook poruke (samo čitanje) | dnevno |
| | Planer narudžbi | Kalendar šivanja i igraonice, kapacitet po tjednu, što treba isporučiti, upozorenja na rokove | narudžbe koje ti upišeš ili potvrdiš | dnevno |
| **Proizvodnja** | Skladište | Stanje tkanina, konca, punila, špage i perli; koliko slova još može iz svake tkanine; kad će nestati | narudžbe + norme potrošnje + inventura | dnevno |
| | Nabava (danas „materijal”) | Prati cijene, akcije i nestašice kod dobavljača; predlaže narudžbu kad skladište javi da nestaje | stranice dobavljača | dnevno |
| **Društvene mreže** | Analitičar mreža | Pregledi, doseg, spremanja; najbolji sati; prosjek zadnjih 5 objava naspram prethodnih 5; što se promijenilo | Instagram i Facebook (Meta Graph API), TikTok | tjedno |
| | Trendovi | Što raste kod sličnih računa (ne samo konkurencije): teme, formati, hashtagovi | Meta Business Discovery i pretraga hashtagova, web | tjedno |
| | Kreator sadržaja | Ideje, scenariji i gotovi kratki videi koji nisu snimanje šivanja: „kako naručiti u 3 koraka”, ime koje se slaže iz šivenih slova, usporedba tkanina, odbrojavanje do rođendana | konfigurator, stranica, plan objava | tjedno |
| **Marketing** | SEO, AI vidljivost, Lokalno, Sadržaj, Konkurencija | kao danas | web, registri | tjedno, mjesečno |
| | Oglasi | od faze 3 (ožujak 2027.) | Meta, Google | tjedno |
| **Web** | Razvoj stranice | Predlaže izmjene stranice i konfiguratora kao pull request. Spajanje radiš ti. | GitHub repozitorij (samo PR, bez spajanja) | na zadatak |

Dodatne ideje (kasnije, ako se pokažu korisne):

- **Sezonski planer**: krštenja, rođendani, Valentinovo, Majčin dan, početak vrtića. Mjesec unaprijed javlja
  koje proizvode i objave pripremiti.
- **Reklamacije i kvaliteta**: zapis svakog problema (pukao šav, kriva boja), da se vidi ponavlja li se.
- **Ponovni kupci**: koliko kupaca naruči drugi put. Brojke bez imena, a podsjetnici samo kao prijedlog tebi.

## Kako se spajamo na vanjske izvore

### Instagram i Facebook (Meta Graph API)

- Instagram mora biti **poslovni ili kreatorski** račun povezan s Facebook stranicom.
- Napravimo vlastitu Meta aplikaciju u **razvojnom načinu** i dodamo samo svoje račune. Za vlastite račune nije
  potreban cijeli postupak pregleda aplikacije. Pristupni token je dugotrajni token stranice ili token
  „system usera” iz Business Managera. Taj token ide u secret, kao i ostali.
- Što dobivamo: za svaku objavu pregledi (views), doseg, lajkovi, komentari, spremanja i dijeljenja; za račun
  pratitelji i kad su pratitelji online po satima. Iz toga se računa najbolji sat objave.
- Trendovi: **Business Discovery** daje javne brojke drugih poslovnih računa (pratitelji, objave, lajkovi i
  komentari po objavi). **Pretraga hashtagova** daje najpopularnije i najnovije objave, uz ograničenje od
  30 različitih hashtagova u 7 dana. Nema struganja stranica.
- Poruke (DM) na Instagramu i Messengeru čitaju se preko istog API-ja uz dozvole za poruke. **Samo čitanje.**

### Gmail

Preporuka je **Google Apps Script u tvom Gmail računu** umjesto vlastite OAuth aplikacije:

- skripta radi pod tvojim računom, svakih sat vremena;
- čita upite s oznakama („Upit za banner”, „Upit za igraonicu”) i naše odgovore u istim nitima;
- prije slanja na ploču **uklanja imena, adrese, e-mail i telefon**;
- na ploču šalje samo: kanal, vrstu, vrijeme upita i odgovora, ishod i anonimizirani tekst za ocjenu tona.

Zašto ne izravni Gmail API: Googleova aplikacija u probnom načinu izdaje tokene koji isteknu za 7 dana. Za
trajan pristup traži se verifikacija i sigurnosna procjena za Gmail dozvole, a to je pretjerano za jedan
račun.

**Ishod upita** (prihvaćen, odbijen, bez odgovora kupca) najpouzdanije se dobiva oznakom u Gmailu:
`Ishod/Prihvaćeno`, `Ishod/Odbijeno`. Agent ishod pokušava i sam prepoznati iz niti, ali oznaka ima prednost.

Prije prvog čitanja treba dopuniti politiku privatnosti (obrada upita uz pomoć AI alata). To je već
odobrena odluka.

### TikTok

- Brojke vlastitih videa (pregledi, lajkovi, dijeljenja) daje TikTokov API za prijavljenog korisnika.
- **Automatsko objavljivanje na TikTok ne radimo.** Ionako bi bilo privatno dok TikTok ne odobri aplikaciju.
  Kreator priprema video, a ti ga objaviš.

### Video iz konfiguratora

Claude ne renderira video, ali može napisati **scenu kao podatke**: ime, tkanine, redoslijed slova, tekstove i
trajanje. Render radi poseban korak:

- **Remotion** (React u MP4) koristi iste SVG komponente šivenih slova kao konfigurator. Video se renderira u
  GitHub Actionu ili na računalu, ne na Workeru. Remotionova licenca je besplatna za tvrtke do 3 zaposlena.
- Gotov MP4 dolazi na ploču kao **odluka** („Objavi ovaj video?”) s pregledom.
- Predlošci videa: *Ime se slaže slovo po slovo*, *Kako naručiti u 3 koraka* (snimke ekrana stranice),
  *Ista riječ u tri tkanine*, *Od upita do paketa* (vremenska crta).

Dok konfigurator `/banneri` ne postoji, Kreator radi scenarije i tekstove, a video dolazi u fazi 4.

## Skladište: kako računamo potrošnju

Ti uneseš tri stvari, a ostalo se računa samo.

1. **Norme**: za svako slovo širina i visina u cm (dobivam od tebe), dodatak za šav, broj slojeva (lice i
   naličje) i iskoristivost krojenja (procjena 75 %, ispravljamo nakon prve inventure). Za banner duljina špage:
   broj slova × razmak + 2 × kraj.
2. **Ulazi**: kupljena tkanina (dezen, metraža × širina bale), konac, punilo, špaga, perle.
3. **Narudžbe**: kad je narudžba potvrđena, zna se koja slova idu iz koje tkanine.

Potrošnja po slovu = (širina + 2 × šav) × (visina + 2 × šav) × slojevi / iskoristivost.

Iz toga ploča pokazuje po tkanini:

- preostalo u m²;
- **koliko još slova** može (prosječno slovo, ili točno za zadano ime);
- **tempo**: potrošnja u zadnjih 30 dana;
- **kad nestaje** pri tom tempu.

Kad je zaliha ispod praga, Skladište javlja Nabavi, a Nabava predlaže narudžbu kao odluku.

**Inventura** (stvarno izmjereno stanje) ima prednost pred izračunom. Razlika se bilježi da se norme s
vremenom poprave.

Tablice (nastavak na postojeću `0002_materijal.sql`):

- `norme_slova` (slovo, sirina_cm, visina_cm)
- `norme_postavke` (sav_cm, slojevi, iskoristivost)
- `skladiste_kretanja` (materijal, vrsta: ulaz | potrosnja | inventura | otpis, kolicina, jedinica, narudzba_id, kad, tko)

Postojeća `materijal_zalihe` postaje izračunato stanje.

## Narudžbe i zajednički kalendar

Jedan model za obje usluge:

| | Šivanje | Igraonica |
|---|---|---|
| Stanja | upit → ponuda → **potvrđeno** → u izradi → gotovo → isporučeno | upit → **opcija** (privremeno) → **potvrđeno** → odrađeno |
| Datum na kalendaru | rok isporuke, plus planirani dani izrade | datum i sat događaja, plus dostava i montaža |
| Kapacitet | sati šivanja po danu (procjena po proizvodu) | jedna igraonica, jedan događaj po terminu |

- **Narudžbu upisuješ ti** ili je potvrđuješ iz prijedloga. Agent Upiti može predložiti „ovaj upit izgleda
  kao potvrđena narudžba”, ali na kalendar ide tek kad ti klikneš.
- Na kalendaru stoji šifra i opis, bez osobnih podataka.
- Planer javlja: što treba isporučiti ovaj tjedan, koji dan je preopterećen, koja opcija igraonice ističe a
  nije potvrđena, i koje narudžbe troše tkaninu koje je malo.

Tablice: `narudzbe` (id, usluga, opis, stanje, rok, termin_od, termin_do, sati_procjena, vrijednost, sifra_racuna),
`narudzbe_stavke` (narudzba_id, proizvod, slova, tkanina_po_slovu_json), `narudzbe_povijest` (promjene stanja,
tko, kad).

## Faze

| Faza | Sadržaj | Ovisi o |
|---|---|---|
| **A. Novi izgled** | prijenos prototipa u pravu ploču: Pregled, Zadaci, odjeli | ništa |
| **B. Narudžbe, kalendar, skladište** | ručni unos narudžbi i ulaza, norme, izračun slova, agenti Planer i Skladište | tvoje norme (širine slova) i popis tkanina |
| **C. Instagram i Facebook** | Meta aplikacija, Analitičar mreža, Trendovi | poslovni IG povezan s FB stranicom |
| **D. Upiti** | Apps Script za Gmail, Meta poruke, agent Upiti | dopuna politike privatnosti |
| **E. Kreator sadržaja** | scenariji odmah, video (Remotion) kad postoji konfigurator | konfigurator `/banneri` |
| **F. Web i financije** | agent Razvoj stranice (samo PR), Financije | GitHub token s pravom samo na PR, izvoz računa |
| **G. Ponuda za druge** | upitnik na mlinarevic.eu, novi zakupac u 1 danu, demo zakupac s izmišljenim podacima | A–C |

Redoslijed B prije C i D je namjeran. Kalendar i skladište ne trebaju vanjske dozvole, a odmah štede vrijeme.
Meta i Gmail traže postavljanje računa i politiku privatnosti.

## Trošak

Dnevni agenti (Upiti, Planer, Skladište, Nabava) uglavnom računaju bez modela. Model zovu samo kad nešto treba
sažeti ili ocijeniti, pa trošak ostaje oko centa na dan. Tjedni (mreže, trendovi, marketing) i mjesečni pregledi
su veći. Procjena za Piccolini je ukupno 10–25 USD mjesečno. Limit od 20 USD vjerojatno treba podići na 30 nakon
faze C; točan broj vidimo iz stvarnih pokretanja.

## Za mlinarevic.eu

Ista ploča, drugi zakupac. Za prodaju trebaju:

1. **Upitnik** za prvi razgovor: djelatnost, procesi, kanali, alati koje već koriste, gdje gube vrijeme, što
   agent smije i ne smije, tko odobrava.
2. **Katalog odjela i agenata** (ova tablica) iz kojeg se slaže ponuda.
3. **Demo zakupac** s izmišljenim podacima, da se ploča može pokazati bez Piccolinijevih brojki.
