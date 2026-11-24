-- Ponude i plaćanje iz Parre (program za račune i fiskalizaciju). Ploča ih samo čita, ništa ne piše u Parru.
-- Bez osobnih podataka: nema imena kupca, OIB-a, adrese, kontakta ni opisa stavki (opis zna sadržavati ime djeteta).

CREATE TABLE parra_ponude (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id INTEGER NOT NULL,                 -- id ponude u Parri
  broj TEXT NOT NULL,                  -- broj ponude (npr. 12-1-1)
  status TEXT NOT NULL,                -- Parra: Issued, Accepted, Denied, Expired
  datum_ponude TEXT,                   -- YYYY-MM-DD
  isporuka_od TEXT,                    -- YYYY-MM-DD; datum isporuke ili početak razdoblja
  isporuka_do TEXT,                    -- YYYY-MM-DD; isti kao od kad nije razdoblje
  iznos REAL,
  valuta TEXT,
  stavke_json TEXT NOT NULL DEFAULT '[]',   -- [{naziv, kolicina, jedinica}] iz popisa stavki, bez opisa
  racuni_json TEXT NOT NULL DEFAULT '[]',   -- [{id, broj, status}] računi napravljeni iz ponude
  placeno REAL,                        -- zbroj uplata po (nestorniranim) računima
  za_platiti REAL,                     -- zbroj iznosa tih računa
  promijenjeno TEXT,                   -- modifiedOn (ili createdOn) iz Parre
  sinkronizirano TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX parra_ponude_isporuka ON parra_ponude (tenant_id, isporuka_od);

-- Gdje je stala sinkronizacija (delta po updatedSince + afterId, kako Parra preporučuje).
CREATE TABLE parra_sinkronizacija (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  kursor_kad TEXT,
  kursor_id INTEGER,
  zadnje TEXT,                         -- zadnji pokušaj
  zadnje_uspjesno TEXT,
  greska TEXT,
  ponuda INTEGER NOT NULL DEFAULT 0    -- koliko je ponuda u bazi
);
