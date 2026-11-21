-- Izvršitelj agenata: izvještaji (umjesto datoteka u repozitoriju) i evidencija pokretanja.

CREATE TABLE izvjestaji (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  agent TEXT NOT NULL,
  kad TEXT NOT NULL,
  naslov TEXT NOT NULL,
  tijelo TEXT NOT NULL,                         -- Markdown
  pokretanje_id TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX izvjestaji_kad ON izvjestaji (tenant_id, kad DESC);

-- pokretanja (iz 0001) dobivaju polja za praćenje troška i uzroka
ALTER TABLE pokretanja ADD COLUMN vrsta TEXT NOT NULL DEFAULT 'zadatak';   -- zadatak | pregled
ALTER TABLE pokretanja ADD COLUMN model TEXT;
ALTER TABLE pokretanja ADD COLUMN opis TEXT;
ALTER TABLE pokretanja ADD COLUMN koraka INTEGER;
ALTER TABLE pokretanja ADD COLUMN pretrage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pokretanja ADD COLUMN tokeni_cache_citanje INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pokretanja ADD COLUMN tokeni_cache_pisanje INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pokretanja ADD COLUMN rezultat TEXT;
ALTER TABLE pokretanja ADD COLUMN kreirano TEXT;
ALTER TABLE pokretanja ADD COLUMN zatim TEXT;                              -- agent koji se pokreće nakon ovoga (lanac)
CREATE INDEX pokretanja_kreirano ON pokretanja (tenant_id, kreirano DESC);
