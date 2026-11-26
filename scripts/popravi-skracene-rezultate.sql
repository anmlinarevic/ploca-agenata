-- Jednokratni popravak (2026-11-26): izvršitelj je rezultat zadatka spremao skraćen na 1000 znakova,
-- a u `pokretanja` je isti odgovor spremljen do 4000 znakova. Ovo vraća dulji tekst u zadatak.
-- Dira samo gotove zadatke kojima uspješno pokretanje ima dulji tekst što počinje točno onim što je u zadatku.
--
-- Pregled prije (samo čita):
--   npx wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --command "SELECT z.id, length(z.rezultat) AS sada, length(p.rezultat) AS bit_ce FROM zadaci z JOIN pokretanja p ON p.tenant_id = z.tenant_id AND p.zadatak_id = z.id AND p.status = 'uspjeh' WHERE z.status = 'gotovo' AND length(p.rezultat) > length(z.rezultat) AND substr(p.rezultat, 1, length(z.rezultat)) = z.rezultat"
-- Popravak:
--   npx wrangler d1 execute ploca --remote --config apps/mcp/wrangler.jsonc --file scripts/popravi-skracene-rezultate.sql

UPDATE zadaci
SET rezultat = (
      SELECT p.rezultat FROM pokretanja p
      WHERE p.tenant_id = zadaci.tenant_id AND p.zadatak_id = zadaci.id AND p.status = 'uspjeh'
        AND length(p.rezultat) > length(zadaci.rezultat)
        AND substr(p.rezultat, 1, length(zadaci.rezultat)) = zadaci.rezultat
      ORDER BY p.kraj DESC LIMIT 1),
    version = version + 1
WHERE status = 'gotovo'
  AND EXISTS (
      SELECT 1 FROM pokretanja p
      WHERE p.tenant_id = zadaci.tenant_id AND p.zadatak_id = zadaci.id AND p.status = 'uspjeh'
        AND length(p.rezultat) > length(zadaci.rezultat)
        AND substr(p.rezultat, 1, length(zadaci.rezultat)) = zadaci.rezultat);
