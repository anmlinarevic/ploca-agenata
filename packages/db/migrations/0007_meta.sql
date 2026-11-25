-- Instagram i Facebook stranica (Meta Graph API), samo čitanje vlastitih računa. Ploča ništa ne objavljuje.
-- Bez osobnih podataka: nema komentara, imena pratitelja ni poruka; opis objave je skraćen i bez @oznaka.

-- Pratitelji po danu (jedan zapis dnevno), da se vidi rast u 30 dana.
CREATE TABLE meta_pratitelji (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kanal TEXT NOT NULL CHECK (kanal IN ('instagram', 'facebook')),
  datum TEXT NOT NULL,                 -- YYYY-MM-DD (Zagreb)
  pratitelji INTEGER,
  PRIMARY KEY (tenant_id, kanal, datum)
);

-- Zbroj za razdoblje: zadnjih 28 dana i 28 dana prije toga.
CREATE TABLE meta_razdoblje (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kanal TEXT NOT NULL CHECK (kanal IN ('instagram', 'facebook')),
  oznaka TEXT NOT NULL CHECK (oznaka IN ('zadnjih', 'prethodnih')),
  od TEXT NOT NULL,
  do TEXT NOT NULL,
  doseg INTEGER,
  pregledi INTEGER,
  interakcije INTEGER,
  spremanja INTEGER,
  dijeljenja INTEGER,
  azurirano TEXT NOT NULL,
  PRIMARY KEY (tenant_id, kanal, oznaka)
);

-- Objave s brojkama (uvidi se osvježavaju dok je objava mlađa od 30 dana).
CREATE TABLE meta_objave (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kanal TEXT NOT NULL CHECK (kanal IN ('instagram', 'facebook')),
  id TEXT NOT NULL,
  vrsta TEXT,                          -- reel, slika, album, video, objava
  objavljeno TEXT NOT NULL,            -- ISO vrijeme (UTC)
  poveznica TEXT,
  opis TEXT,                           -- prvih 90 znakova, bez @oznaka, e-mailova i brojeva telefona
  pregledi INTEGER,
  doseg INTEGER,
  lajkovi INTEGER,
  komentari INTEGER,
  spremanja INTEGER,
  dijeljenja INTEGER,
  klikovi INTEGER,
  uvidi_azurirani TEXT,
  PRIMARY KEY (tenant_id, kanal, id)
);
CREATE INDEX meta_objave_vrijeme ON meta_objave (tenant_id, kanal, objavljeno);

CREATE TABLE meta_sinkronizacija (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  ig_korisnik TEXT,                    -- id Instagram poslovnog računa (dolazi sa stranice)
  ig_ime TEXT,                         -- @korisničko ime računa
  stranica_ime TEXT,                   -- naziv Facebook stranice
  zadnje TEXT,
  zadnje_uspjesno TEXT,
  greska TEXT,
  upozorenja_json TEXT NOT NULL DEFAULT '[]'  -- djelomični problemi (npr. metrika koju Meta više ne daje)
);
