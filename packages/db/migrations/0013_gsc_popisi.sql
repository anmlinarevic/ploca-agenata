-- Search Console po razdoblju: popisi upita, stranica i zemalja za izabrano razdoblje dohvaćaju se iz Search Consolea pri otvaranju ekrana
-- i kratko se pamte (12 sati), da svaki klik na razdoblje ne troši zahtjeve. Dnevni zbrojevi dolaze iz gsc_dani (sada godinu dana).
CREATE TABLE gsc_popisi (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  od TEXT NOT NULL,                       -- YYYY-MM-DD, razdoblje popisa
  do TEXT NOT NULL,
  vrsta TEXT NOT NULL CHECK (vrsta IN ('upit', 'stranica', 'zemlja')),
  podaci_json TEXT NOT NULL,              -- [{kljuc, klikovi, pojavljivanja, ctr, pozicija, klikovi_prije, pojavljivanja_prije, pozicija_prije}]
  azurirano TEXT NOT NULL,
  PRIMARY KEY (tenant_id, od, do, vrsta)
);
