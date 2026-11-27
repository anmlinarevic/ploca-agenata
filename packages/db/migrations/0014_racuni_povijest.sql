-- Dnevni pregledi i doseg po računu (brojke_dan) pune se u komadima od 30 dana unazad do godine dana.
-- povijest_dnevno_od: najraniji datum do kojeg su dnevne brojke učitane; NULL = još nije počelo.
ALTER TABLE racuni ADD COLUMN povijest_dnevno_od TEXT;
ALTER TABLE racuni ADD COLUMN dnevno_greska TEXT;   -- zašto dnevne brojke nisu dostupne (npr. Meta ne daje tu metriku), da ekran to kaže
