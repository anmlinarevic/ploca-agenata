-- Ploča agenata: osnovna shema. Svaka tablica s podacima zakupca ima tenant_id.
-- Pristup samo kroz packages/db (tenant_id se nikad ne uzima iz tijela zahtjeva).

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  naziv TEXT NOT NULL,
  domena TEXT,
  jezik TEXT NOT NULL DEFAULT 'hr',
  postavke_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),        -- NULL = savjetnik (vidi sve zakupce)
  email TEXT NOT NULL UNIQUE,
  uloga TEXT NOT NULL CHECK (uloga IN ('vlasnik', 'savjetnik'))
);

CREATE TABLE agent_tokeni (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  hash TEXT NOT NULL UNIQUE,                    -- SHA-256(pepper + token), token se ne sprema
  agent TEXT NOT NULL,                          -- koordinator, konkurencija, seo, ai, sadrzaj, lokalno, oglasi, materijal
  dopusteni_alati TEXT NOT NULL DEFAULT '*',    -- zarezom odvojen popis ili *
  istice TEXT,
  opozvan INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE odluke (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  naslov TEXT NOT NULL,
  agent TEXT NOT NULL,
  razlog TEXT,
  prijedlog TEXT,
  poveznica TEXT,
  poveznica_tekst TEXT,
  prioritet INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'ceka'
    CHECK (status IN ('ceka', 'odobreno', 'odbijeno', 'u_izradi', 'gotovo')),
  kreirano TEXT NOT NULL,
  komentar TEXT,
  odluceno_at TEXT,
  odlucio_user_id TEXT REFERENCES users(id),
  rezultat TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX odluke_status ON odluke (tenant_id, status);

CREATE TABLE zadaci (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  opis TEXT NOT NULL,
  agent TEXT NOT NULL,
  rok TEXT,
  status TEXT NOT NULL DEFAULT 'novo'
    CHECK (status IN ('novo', 'u_izradi', 'gotovo', 'odbijeno')),
  kreirano TEXT NOT NULL,
  sesija TEXT,
  rezultat TEXT,
  poveznica TEXT,
  pokretanje_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX zadaci_status ON zadaci (tenant_id, status);

CREATE TABLE tjedni (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  tjedan TEXT NOT NULL,                         -- GGGG-Www
  od TEXT,
  upiti_banner INTEGER,
  upiti_igraonica INTEGER,
  narudzbe INTEGER,
  rezervacije INTEGER,
  recenzije INTEGER,
  izvori_json TEXT NOT NULL DEFAULT '{}',       -- {instagram, facebook, google, ai, preporuka, ostalo}
  PRIMARY KEY (tenant_id, tjedan)
);

CREATE TABLE mjesecno (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  mjesec TEXT NOT NULL,                         -- GGGG-MM
  ai_spominjanja INTEGER,
  ai_pitanja INTEGER,
  gsc_klikovi INTEGER,
  gsc_pojavljivanja INTEGER,
  napomena TEXT,
  PRIMARY KEY (tenant_id, mjesec)
);

CREATE TABLE napredak_faze (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,                             -- faza0..faza3
  naziv TEXT NOT NULL,
  kad TEXT,
  red INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE napredak_stavke (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  faza_id TEXT NOT NULL,
  red INTEGER NOT NULL,
  t TEXT NOT NULL,
  gotovo INTEGER NOT NULL DEFAULT 0,
  tko TEXT,
  PRIMARY KEY (tenant_id, faza_id, red),
  FOREIGN KEY (tenant_id, faza_id) REFERENCES napredak_faze (tenant_id, id)
);

CREATE TABLE aktivnost (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kad TEXT NOT NULL,
  agent TEXT NOT NULL,
  sto TEXT NOT NULL,
  poveznica TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX aktivnost_kad ON aktivnost (tenant_id, kad DESC);

CREATE TABLE konkurenti (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  naziv TEXT NOT NULL,
  mi INTEGER NOT NULL DEFAULT 0,                -- 1 = naš red
  trziste TEXT,                                 -- HR, SI, lokalno
  razina TEXT,                                  -- A, B...
  red INTEGER NOT NULL DEFAULT 0,
  izvor TEXT,
  provjereno TEXT,
  proizvod TEXT,
  cijena_tekst TEXT,
  velicina TEXT,
  vrsta TEXT,
  mjesto TEXT,
  napomena TEXT,
  usporedba_json TEXT,                          -- izravna usporedba: c3, c5, c8, cDod, motiv, ...
  prednosti_json TEXT,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE pokretanja (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  zadatak_id TEXT,
  agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'u_redu',
  pocetak TEXT,
  kraj TEXT,
  tokeni_ulaz INTEGER,
  tokeni_izlaz INTEGER,
  trosak_usd REAL,
  greska TEXT,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  kad TEXT NOT NULL,
  akter TEXT NOT NULL,                          -- 'agent:koordinator' ili 'user:<id>'
  akcija TEXT NOT NULL,
  entitet TEXT,
  entitet_id TEXT,
  prije_json TEXT,
  poslije_json TEXT
);
CREATE INDEX audit_tenant_kad ON audit_log (tenant_id, kad DESC);
