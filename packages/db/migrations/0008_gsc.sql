-- Google Search Console, samo čitanje (servisni račun s ograničenim pravom na svojstvo).
-- Upiti su skraćeni i bez e-mailova i brojeva telefona; Google rijetke upite ionako ne pokazuje.

-- Klikovi po danu (zadnjih ~3 mjeseca), za graf i mjesečne zbrojeve.
CREATE TABLE gsc_dani (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  datum TEXT NOT NULL,                 -- YYYY-MM-DD (datum u Search Consoleu, pacifičko vrijeme)
  klikovi INTEGER,
  pojavljivanja INTEGER,
  ctr REAL,                            -- 0..1
  pozicija REAL,
  PRIMARY KEY (tenant_id, datum)
);

-- Zbroj za zadnjih 28 dana i 28 dana prije toga.
CREATE TABLE gsc_razdoblje (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  oznaka TEXT NOT NULL CHECK (oznaka IN ('zadnjih', 'prethodnih')),
  od TEXT NOT NULL,
  do TEXT NOT NULL,
  klikovi INTEGER,
  pojavljivanja INTEGER,
  ctr REAL,
  pozicija REAL,
  azurirano TEXT NOT NULL,
  PRIMARY KEY (tenant_id, oznaka)
);

-- Najbolji upiti, stranice i zemlje za zadnjih 28 dana (s brojkama prethodnih 28 dana). Zamjenjuje se pri svakom osvježavanju.
CREATE TABLE gsc_stavke (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  vrsta TEXT NOT NULL CHECK (vrsta IN ('upit', 'stranica', 'zemlja')),
  kljuc TEXT NOT NULL,
  klikovi INTEGER,
  pojavljivanja INTEGER,
  ctr REAL,
  pozicija REAL,
  klikovi_prije INTEGER,
  pojavljivanja_prije INTEGER,
  pozicija_prije REAL,
  PRIMARY KEY (tenant_id, vrsta, kljuc)
);

-- Poslani sitemapi.
CREATE TABLE gsc_sitemapi (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  putanja TEXT NOT NULL,
  poslano TEXT,
  zadnje_preuzeto TEXT,
  ceka INTEGER,                        -- 1 = Google ga još obrađuje
  greske INTEGER,
  upozorenja INTEGER,
  adresa INTEGER,                      -- broj adresa u sitemapu prema Googleu
  PRIMARY KEY (tenant_id, putanja)
);

-- Je li stranica iz sitemapa u Googleovom indeksu (URL Inspection API, najviše jednom dnevno po adresi).
CREATE TABLE gsc_url (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  url TEXT NOT NULL,
  presuda TEXT,                        -- PASS, NEUTRAL, PARTIAL, FAIL
  pokrivenost TEXT,                    -- npr. "Submitted and indexed", "Crawled - currently not indexed"
  zadnje_puzanje TEXT,
  dohvat TEXT,                         -- pageFetchState
  robots TEXT,                         -- robotsTxtState
  kanonski_google TEXT,
  kanonski_nas TEXT,
  provjereno TEXT,
  PRIMARY KEY (tenant_id, url)
);

CREATE TABLE gsc_sinkronizacija (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  svojstvo TEXT,                       -- npr. sc-domain:piccoliniplay.hr
  racun TEXT,                          -- e-mail servisnog računa (nije tajna; treba ga dodati u Search Console)
  dozvola TEXT,                        -- permissionLevel svojstva
  do_datuma TEXT,                      -- zadnji dan s podacima
  zadnje TEXT,
  zadnje_uspjesno TEXT,
  greska TEXT,
  upozorenja_json TEXT NOT NULL DEFAULT '[]'
);
