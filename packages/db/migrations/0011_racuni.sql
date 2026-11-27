-- Računi na društvenim mrežama: više računa po mreži (npr. dva Instagram računa, dvije Facebook stranice).
-- Do sada je Meta bila spojena za točno jednu Facebook stranicu i jedan Instagram račun po zakupcu (tajna META_STRANICA);
-- brojke i objave nisu znale kojem računu pripadaju. Ova migracija uvodi pojam računa i prebacuje postojeće podatke na njega.

CREATE TABLE racuni (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  mreza TEXT NOT NULL CHECK (mreza IN ('facebook', 'instagram', 'tiktok')),
  naziv TEXT NOT NULL,                          -- naziv na ploči (npr. @piccolini.sivanje)
  naziv_rucno INTEGER NOT NULL DEFAULT 0,       -- 1 = naziv je upisao čovjek; sinkronizacija ga tada ne mijenja
  usluga TEXT NOT NULL DEFAULT 'oboje' CHECK (usluga IN ('banneri', 'igraonica', 'oboje')),
  vanjski_id TEXT,                              -- Facebook: id stranice; Instagram: id poslovnog računa; TikTok: open_id
  stranica_id TEXT,                             -- Meta: id Facebook stranice preko koje se račun čita (i za Instagram)
  status TEXT NOT NULL DEFAULT 'ceka' CHECK (status IN ('ceka', 'spojeno', 'rucno', 'greska')),
  zadnje TEXT,                                  -- zadnji pokušaj osvježavanja
  zadnje_uspjesno TEXT,
  greska TEXT,
  upozorenja_json TEXT NOT NULL DEFAULT '[]',
  povijest_od TEXT,                             -- od kojeg datuma ploča ima dnevne brojke računa (YYYY-MM-DD)
  aktivan INTEGER NOT NULL DEFAULT 1,           -- 0 = uklonjen s ploče; podaci ostaju u bazi
  kreirano TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
-- Isti vanjski račun ne smije biti dvaput aktivan. Uklonjeni računi ne blokiraju ponovno dodavanje.
CREATE UNIQUE INDEX racuni_vanjski ON racuni (tenant_id, mreza, vanjski_id) WHERE vanjski_id IS NOT NULL AND aktivan = 1;
CREATE UNIQUE INDEX racuni_stranica ON racuni (tenant_id, mreza, stranica_id) WHERE stranica_id IS NOT NULL AND aktivan = 1;
CREATE INDEX racuni_zakupac ON racuni (tenant_id, aktivan, mreza);

-- Dnevne brojke po računu i mjeri: osnova za odabir razdoblja (dan do godina dana). Mjere: pratitelji, pregledi, doseg, klikovi,
-- interakcije, spremanja, dijeljenja. Doseg je po danu; za dulja razdoblja se zbraja pa nije broj jedinstvenih osoba.
CREATE TABLE brojke_dan (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  racun_id TEXT NOT NULL,
  datum TEXT NOT NULL,                          -- YYYY-MM-DD (Zagreb)
  mjera TEXT NOT NULL,
  vrijednost INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, racun_id, datum, mjera)
);
CREATE INDEX brojke_dan_razdoblje ON brojke_dan (tenant_id, racun_id, mjera, datum);

-- ---- postojeći Meta podaci prelaze na račune ----
-- Računi iz dosadašnje sinkronizacije. Id stranice je bio tajna Workera, pa se stranica_id upisuje pri prvom osvježavanju.
INSERT INTO racuni (id, tenant_id, mreza, naziv, naziv_rucno, usluga, vanjski_id, stranica_id, status, zadnje, zadnje_uspjesno, greska, upozorenja_json, aktivan, kreirano)
  SELECT 'facebook-1', tenant_id, 'facebook', COALESCE(stranica_ime, 'Facebook stranica'), 0, 'oboje', NULL, NULL,
         CASE WHEN greska IS NOT NULL THEN 'greska' WHEN zadnje_uspjesno IS NOT NULL THEN 'spojeno' ELSE 'ceka' END,
         zadnje, zadnje_uspjesno, greska, upozorenja_json, 1, COALESCE(zadnje, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  FROM meta_sinkronizacija;
INSERT INTO racuni (id, tenant_id, mreza, naziv, naziv_rucno, usluga, vanjski_id, stranica_id, status, zadnje, zadnje_uspjesno, greska, upozorenja_json, aktivan, kreirano)
  SELECT 'instagram-1', tenant_id, 'instagram', CASE WHEN ig_ime IS NOT NULL THEN '@' || ig_ime ELSE 'Instagram račun' END, 0, 'oboje', ig_korisnik, NULL,
         CASE WHEN greska IS NOT NULL THEN 'greska' WHEN zadnje_uspjesno IS NOT NULL THEN 'spojeno' ELSE 'ceka' END,
         zadnje, zadnje_uspjesno, greska, upozorenja_json, 1, COALESCE(zadnje, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  FROM meta_sinkronizacija WHERE ig_korisnik IS NOT NULL;

-- Pratitelji po danu postaju brojke po danu.
INSERT INTO brojke_dan (tenant_id, racun_id, datum, mjera, vrijednost)
  SELECT tenant_id, CASE kanal WHEN 'facebook' THEN 'facebook-1' ELSE 'instagram-1' END, datum, 'pratitelji', pratitelji
  FROM meta_pratitelji WHERE pratitelji IS NOT NULL
    AND CASE kanal WHEN 'facebook' THEN 'facebook-1' ELSE 'instagram-1' END IN (SELECT id FROM racuni WHERE racuni.tenant_id = meta_pratitelji.tenant_id);
UPDATE racuni SET povijest_od = (SELECT MIN(datum) FROM brojke_dan b WHERE b.tenant_id = racuni.tenant_id AND b.racun_id = racuni.id)
  WHERE mreza IN ('facebook', 'instagram');

-- meta_razdoblje i meta_objave dobivaju racun_id u ključu (SQLite ne mijenja primarni ključ, pa se tablice grade ispočetka).
CREATE TABLE meta_razdoblje_nova (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  racun_id TEXT NOT NULL,
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
  PRIMARY KEY (tenant_id, racun_id, oznaka)
);
INSERT INTO meta_razdoblje_nova (tenant_id, racun_id, kanal, oznaka, od, do, doseg, pregledi, interakcije, spremanja, dijeljenja, azurirano)
  SELECT tenant_id, CASE kanal WHEN 'facebook' THEN 'facebook-1' ELSE 'instagram-1' END, kanal, oznaka, od, do, doseg, pregledi, interakcije, spremanja, dijeljenja, azurirano
  FROM meta_razdoblje;
DROP TABLE meta_razdoblje;
ALTER TABLE meta_razdoblje_nova RENAME TO meta_razdoblje;

CREATE TABLE meta_objave_nova (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  racun_id TEXT NOT NULL,
  kanal TEXT NOT NULL CHECK (kanal IN ('instagram', 'facebook')),
  id TEXT NOT NULL,
  vrsta TEXT,
  objavljeno TEXT NOT NULL,
  poveznica TEXT,
  opis TEXT,
  pregledi INTEGER,
  doseg INTEGER,
  lajkovi INTEGER,
  komentari INTEGER,
  spremanja INTEGER,
  dijeljenja INTEGER,
  klikovi INTEGER,
  uvidi_azurirani TEXT,
  PRIMARY KEY (tenant_id, racun_id, id)
);
INSERT INTO meta_objave_nova (tenant_id, racun_id, kanal, id, vrsta, objavljeno, poveznica, opis, pregledi, doseg, lajkovi, komentari, spremanja, dijeljenja, klikovi, uvidi_azurirani)
  SELECT tenant_id, CASE kanal WHEN 'facebook' THEN 'facebook-1' ELSE 'instagram-1' END, kanal, id, vrsta, objavljeno, poveznica, opis, pregledi, doseg, lajkovi, komentari, spremanja, dijeljenja, klikovi, uvidi_azurirani
  FROM meta_objave;
DROP TABLE meta_objave;
ALTER TABLE meta_objave_nova RENAME TO meta_objave;
CREATE INDEX meta_objave_vrijeme ON meta_objave (tenant_id, racun_id, objavljeno);

-- meta_pratitelji i meta_sinkronizacija ostaju kao zastarjele (kod ih više ne čita ni ne piše); uklanjaju se kad migracija prođe na produkciji.
