-- Objava pripada točno jednom računu na mreži (npr. @piccolini.sivanje na Instagramu), a ista ideja za više računa
-- je više povezanih objava (grupa_id), svaka sa svojim opisom, terminom i statusom.
ALTER TABLE objave ADD COLUMN racun_id TEXT;   -- racuni.id; NULL = objava iz vremena prije računa ili mreža bez dodanog računa
ALTER TABLE objave ADD COLUMN grupa_id TEXT;   -- ista ideja objavljena na više računa
CREATE INDEX objave_racun ON objave (tenant_id, racun_id, status);
CREATE INDEX objave_grupa ON objave (tenant_id, grupa_id) WHERE grupa_id IS NOT NULL;

-- Postojeće objave: ako zakupac na toj mreži ima točno jedan aktivan račun, objava pripada njemu.
UPDATE objave SET racun_id = (
  SELECT r.id FROM racuni r WHERE r.tenant_id = objave.tenant_id AND r.mreza = objave.kanal AND r.aktivan = 1)
WHERE racun_id IS NULL AND (
  SELECT COUNT(*) FROM racuni r WHERE r.tenant_id = objave.tenant_id AND r.mreza = objave.kanal AND r.aktivan = 1) = 1;
