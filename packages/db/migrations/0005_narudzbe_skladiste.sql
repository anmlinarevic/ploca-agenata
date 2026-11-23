-- Faza B: narudžbe (šivanje i igraonica), zajednički kalendar i skladište s izračunom potrošnje.
-- Bez osobnih podataka kupaca: narudžba ima šifru i kratak opis; ime, adresa i telefon ostaju izvan ploče.

-- Artikli na skladištu. Tkanine imaju id = šifra dezena sa stranice (D01…), jedinica m².
CREATE TABLE artikli (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  naziv TEXT NOT NULL,
  kategorija TEXT NOT NULL CHECK (kategorija IN ('tkanina', 'spaga', 'traka', 'perle', 'masnice', 'punilo', 'ambalaza', 'ostalo')),
  jedinica TEXT NOT NULL CHECK (jedinica IN ('m2', 'm', 'kom', 'g', 'par')),
  prag REAL,                                     -- ispod ovoga skladište javlja „naruči uskoro”
  boja TEXT,                                     -- za prikaz uzorka tkanine
  izvor TEXT,                                    -- dobavljač i šifra
  izvor_url TEXT,
  materijal_id TEXT,                             -- veza na agenta za cijene (tablica materijali), neobavezno
  aktivno INTEGER NOT NULL DEFAULT 1,
  red INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);

-- Svako kretanje je jedan red. Stanje = zadnja inventura + ulazi + povrati - potrošnja - otpis nakon nje.
CREATE TABLE skladiste_kretanja (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  artikl_id TEXT NOT NULL,
  vrsta TEXT NOT NULL CHECK (vrsta IN ('ulaz', 'potrosnja', 'inventura', 'otpis', 'povrat')),
  kolicina REAL NOT NULL CHECK (kolicina >= 0),  -- inventura: izmjereno stanje; ostalo: iznos promjene
  kad TEXT NOT NULL,
  narudzba_id TEXT,                              -- automatska potrošnja iz narudžbe
  napomena TEXT,
  tko TEXT NOT NULL,                             -- user:<id> | sustav
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX skladiste_kretanja_artikl ON skladiste_kretanja (tenant_id, artikl_id, kad);
CREATE INDEX skladiste_kretanja_narudzba ON skladiste_kretanja (tenant_id, narudzba_id);

-- Norme potrošnje (ključ → broj). Ključ koji nedostaje uzima zadanu vrijednost iz packages/poslovanje.
CREATE TABLE norme (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kljuc TEXT NOT NULL,
  vrijednost REAL NOT NULL,
  azurirano TEXT NOT NULL,
  PRIMARY KEY (tenant_id, kljuc)
);

CREATE TABLE narudzbe (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  sifra TEXT NOT NULL,                           -- N-0001 (šivanje), R-001 (igraonica)
  usluga TEXT NOT NULL CHECK (usluga IN ('sivanje', 'igraonica')),
  opis TEXT NOT NULL,
  stanje TEXT NOT NULL,
  rok TEXT,                                      -- šivanje: datum isporuke (YYYY-MM-DD)
  termin_od TEXT,                                -- igraonica: početak (YYYY-MM-DDTHH:MM)
  termin_do TEXT,
  opcija_do TEXT,                                -- igraonica: do kada opcija drži termin
  izrada_json TEXT,                              -- planirani dani izrade [{"dan":"2026-11-24","sati":1.5}]
  sati_procjena REAL,
  dostava TEXT,                                  -- preuzimanje | boxnow | osobno | montaza
  vrijednost_eur REAL,
  sifra_racuna TEXT,                             -- veza na program za račune
  stavke_json TEXT,                              -- specifikacija proizvoda (banner: tekst, dezeni po slovu, motivi)
  napomena TEXT,
  kreirano TEXT NOT NULL,
  azurirano TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, sifra)
);
CREATE INDEX narudzbe_rok ON narudzbe (tenant_id, rok);
CREATE INDEX narudzbe_termin ON narudzbe (tenant_id, termin_od);
CREATE INDEX narudzbe_stanje ON narudzbe (tenant_id, stanje);

CREATE TABLE narudzbe_povijest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  narudzba_id TEXT NOT NULL,
  kad TEXT NOT NULL,
  prije TEXT,
  poslije TEXT NOT NULL,
  tko TEXT NOT NULL
);
CREATE INDEX narudzbe_povijest_idx ON narudzbe_povijest (tenant_id, narudzba_id, kad);
