-- Registri (Markdown dokumenti koje agenti održavaju): ključne riječi, AI test, partneri, dnevnik odluka, plan sadržaja.
-- Zamjena za datoteke u docs/marketing/ jer izvršitelj nema pristup repozitoriju.

CREATE TABLE registri (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kljuc TEXT NOT NULL,
  naslov TEXT NOT NULL,
  tijelo TEXT NOT NULL,                         -- Markdown
  verzija INTEGER NOT NULL DEFAULT 1,
  azurirano TEXT NOT NULL,
  azurirao TEXT NOT NULL,                       -- 'agent:seo', 'uvoz', 'user:<id>'
  PRIMARY KEY (tenant_id, kljuc)
);
