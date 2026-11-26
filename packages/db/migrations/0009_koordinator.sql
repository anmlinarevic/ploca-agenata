-- Koordinator kao jedini sugovornik: vlasnik piše koordinatoru, koordinator daje zadatke agentima,
-- javlja što fali (pristupi) i odgovara u razgovoru. Odluka ili zadatak uvijek pokazuje tko je na potezu.

-- Razgovor vlasnika i koordinatora. „ploca” su obavijesti ploče (npr. agent je završio zadatak).
CREATE TABLE razgovor (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kad TEXT NOT NULL,
  tko TEXT NOT NULL CHECK (tko IN ('ti', 'koordinator', 'ploca')),
  tekst TEXT NOT NULL,
  user_id TEXT,
  pokretanje_id TEXT,                           -- pokretanje koordinatora koje odgovara na poruku (ili je odgovorilo)
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX razgovor_kad ON razgovor (tenant_id, kad DESC);

-- Što vlasnik mora dati da bi agenti mogli raditi: pristup, ključ, token. Upisuje ga koordinator.
CREATE TABLE pristupi (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  agent TEXT,                                   -- agent kojem treba (NULL = još ne postoji)
  sto TEXT NOT NULL,                            -- npr. „GitHub token za repozitorij stranice (samo pull request)”
  zasto TEXT,
  kako TEXT,                                    -- koraci za vlasnika
  status TEXT NOT NULL DEFAULT 'otvoreno' CHECK (status IN ('otvoreno', 'rijeseno', 'odbijeno')),
  kreirano TEXT NOT NULL,
  rijeseno TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX pristupi_status ON pristupi (tenant_id, status);

-- Zadatke agentima sada daje koordinator (iz poruke vlasnika ili odobrene odluke) i oni se pokreću sami.
ALTER TABLE zadaci ADD COLUMN zadao TEXT NOT NULL DEFAULT 'ti';         -- ti | koordinator
ALTER TABLE zadaci ADD COLUMN odluka_id TEXT;                           -- odobrena odluka koju zadatak izvršava
ALTER TABLE zadaci ADD COLUMN razgovor_id TEXT;                         -- poruka vlasnika iz koje je nastao
ALTER TABLE zadaci ADD COLUMN automatski INTEGER NOT NULL DEFAULT 0;    -- 1 = izvršitelj ga pokreće sam

-- Što vlasnik mora napraviti da bi se odobrena odluka izvršila (NULL = ništa, radi agent ili koordinator).
ALTER TABLE odluke ADD COLUMN ceka_tebe TEXT;

-- Pokretanje koordinatora zbog poruke ili odobrene odluke.
ALTER TABLE pokretanja ADD COLUMN razgovor_id TEXT;
ALTER TABLE pokretanja ADD COLUMN odluka_id TEXT;

-- Odluke koje je koordinator do sada ostavljao „za Claude Code” čekaju vlasnika.
UPDATE odluke SET ceka_tebe = 'Izmjena stranice: nijedan agent još nema pristup repozitoriju. Napravi je s Claude Codeom (PR) ili daj agentu pristup GitHubu.'
  WHERE status = 'u_izradi' AND rezultat LIKE 'Čeka izradu u Claude Codeu%';
