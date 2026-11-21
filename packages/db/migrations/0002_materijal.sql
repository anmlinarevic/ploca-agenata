-- Agent za potrošni materijal: dnevno praćenje cijena i dostupnosti.

CREATE TABLE materijali (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  naziv TEXT NOT NULL,
  kategorija TEXT,                              -- tkanina, punilo, konac, perle, ambalaža, ostalo
  dobavljac TEXT,
  url TEXT NOT NULL,
  kriticno INTEGER NOT NULL DEFAULT 0,
  jedinica TEXT,
  minimalna_zaliha REAL,
  pravilo_citanja_json TEXT,                    -- kako parser čita cijenu/dostupnost s te stranice
  aktivno INTEGER NOT NULL DEFAULT 1,
  zadnja_provjera TEXT,
  zadnja_cijena REAL,
  zadnja_dostupnost TEXT,
  PRIMARY KEY (tenant_id, id)
);

-- jedan red po promjeni, ne po provjeri
CREATE TABLE materijal_cijene (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  materijal_id TEXT NOT NULL,
  kad TEXT NOT NULL,
  cijena REAL,
  valuta TEXT NOT NULL DEFAULT 'EUR',
  dostupnost TEXT,                              -- na_zalihi, nema, nepoznato
  izvor TEXT NOT NULL DEFAULT 'parser'          -- parser | llm
);
CREATE INDEX materijal_cijene_idx ON materijal_cijene (tenant_id, materijal_id, kad DESC);

CREATE TABLE materijal_dogadaji (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  materijal_id TEXT NOT NULL,
  kad TEXT NOT NULL,
  vrsta TEXT NOT NULL CHECK (vrsta IN
    ('poskupljenje', 'pojeftinjenje', 'akcija', 'nestasica', 'ponovo_dostupno',
     'povucen', 'stranica_promijenjena', 'alternativa')),
  prije TEXT,
  poslije TEXT,
  sazetak TEXT,
  ozbiljnost INTEGER NOT NULL DEFAULT 2,
  obavijesteno INTEGER NOT NULL DEFAULT 0,
  potvrdio_user_id TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX materijal_dogadaji_kad ON materijal_dogadaji (tenant_id, kad DESC);

CREATE TABLE materijal_zalihe (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  materijal_id TEXT NOT NULL,
  kolicina REAL NOT NULL,
  azurirano TEXT NOT NULL,
  PRIMARY KEY (tenant_id, materijal_id)
);
