-- Objave za društvene mreže (TikTok, kasnije Instagram i Facebook).
-- Claude ih izrađuje u zakazanim sesijama i šalje preko MCP-a; vlasnik svaku odobrava na ploči.
-- Mediji (videi, slajdovi, sirove snimke) su u R2 (binding MEDIJI), ključ uvijek počinje s "<tenant_id>/".

-- Tjedni plan objava: jedan po tjednu. Claude ga može mijenjati dok nije odobren.
CREATE TABLE planovi_objava (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  tjedan TEXT NOT NULL,                         -- ISO tjedan, npr. 2026-W50
  naslov TEXT NOT NULL,
  sazetak TEXT,                                 -- brojke prošlog tjedna, ideja tjedna, popis kadrova za snimiti
  status TEXT NOT NULL DEFAULT 'ceka' CHECK (status IN ('ceka', 'odobreno', 'vraceno')),
  komentar TEXT,                                -- zadnji komentar vlasnika (obavezan kad vrati)
  odlucio_user_id TEXT,
  odluceno_at TEXT,
  kreirano TEXT NOT NULL,
  azurirano TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX planovi_objava_tjedan ON planovi_objava (tenant_id, tjedan);

-- Pojedina objava. Ništa ne ide van dok status nije 'odobreno'; 'objavljeno' upisuje čovjek (ili kasnije ploča).
CREATE TABLE objave (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_id TEXT,
  kanal TEXT NOT NULL DEFAULT 'tiktok' CHECK (kanal IN ('tiktok', 'instagram', 'facebook')),
  serija TEXT,                                  -- imena, iza-sava, proslave, igraonica, ostalo
  vrsta TEXT NOT NULL CHECK (vrsta IN ('video', 'slajdovi')),
  naslov TEXT NOT NULL,                         -- interni naslov za ploču
  opis TEXT NOT NULL,                           -- tekst objave s hashtagovima, onako kako ide van
  scenarij TEXT,                                -- kadrovi i napomene za pregled
  termin TEXT,                                  -- predloženo vrijeme objave (ISO)
  mediji_json TEXT NOT NULL DEFAULT '[]',       -- [{ kljuc, mime, velicina }] redom kojim idu u objavu
  knjiznica_json TEXT NOT NULL DEFAULT '[]',    -- id-jevi materijala iz knjižnice koji su korišteni
  ai_oznaka INTEGER NOT NULL DEFAULT 0,         -- 1 = pri objavi uključiti TikTokovu oznaku „AI-generated”
  status TEXT NOT NULL DEFAULT 'ceka' CHECK (status IN ('ceka', 'odobreno', 'vraceno', 'odbaceno', 'objavljeno')),
  komentar TEXT,                                -- zadnji komentar vlasnika
  odlucio_user_id TEXT,
  odluceno_at TEXT,
  objavljeno_at TEXT,
  poveznica TEXT,                               -- adresa objave na mreži, kad je objavljena
  izmjena INTEGER NOT NULL DEFAULT 1,           -- koja je ovo inačica sadržaja (raste kad Claude ispravi vraćenu)
  kreirano TEXT NOT NULL,
  azurirano TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX objave_status ON objave (tenant_id, status, termin);
CREATE INDEX objave_plan ON objave (tenant_id, plan_id);

-- Knjižnica materijala: vlastite fotografije i sirove snimke koje vlasnik učita s mobitela.
-- Claude smije koristiti samo ono što je označeno kao slobodno, a dijete bez pristanka roditelja nikad nije slobodno.
CREATE TABLE knjiznica (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kljuc TEXT NOT NULL,                          -- R2 ključ
  naziv TEXT,                                   -- izvorno ime datoteke
  vrsta TEXT NOT NULL CHECK (vrsta IN ('foto', 'video')),
  mime TEXT NOT NULL,
  velicina INTEGER NOT NULL,
  usluga TEXT NOT NULL DEFAULT 'banneri' CHECK (usluga IN ('banneri', 'igraonica', 'oboje')),
  opis TEXT,                                    -- što je na snimci (Claude bira po ovome)
  ima_djece INTEGER NOT NULL DEFAULT 0,
  pristanak INTEGER NOT NULL DEFAULT 0,         -- pisani pristanak roditelja za prepoznatljivo dijete
  slobodno INTEGER NOT NULL DEFAULT 0,          -- smije u objavu
  ucitao TEXT,                                  -- user id
  kreirano TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (NOT (ima_djece = 1 AND pristanak = 0 AND slobodno = 1))
);
CREATE INDEX knjiznica_slobodno ON knjiznica (tenant_id, slobodno, kreirano DESC);

-- Jednokratne adrese za učitavanje u R2 i preuzimanje iz R2 preko MCP workera (Claude nema R2 ključeve).
CREATE TABLE prijenosi (
  hash TEXT PRIMARY KEY,                        -- SHA-256 tokena iz adrese; token se ne sprema
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  smjer TEXT NOT NULL CHECK (smjer IN ('gore', 'dolje')),
  kljuc TEXT NOT NULL,
  mime TEXT,
  max_bajtova INTEGER,
  agent TEXT NOT NULL,
  istice TEXT NOT NULL,
  iskoristeno TEXT
);
