// Definicije agenata za izvršitelj. Tekst uputa je u .md datotekama (Wrangler ih učitava kao tekst).
// `web`: smije li agent pretraživati i čitati web (server alati Claude API-ja).
// `alati`: neobavezno ograničenje na imena MCP alata; inače vrijedi ono što dopušta token agenta.
import konkurencija from './konkurencija.md';
import koordinator from './koordinator.md';

export const AGENTI = {
  konkurencija: { naziv: 'Konkurencija', prompt: konkurencija, web: true, maxKoraka: 25 },
  koordinator: { naziv: 'Koordinator', prompt: koordinator, web: false, maxKoraka: 15 },
};

/** Tjedni pregled: redoslijed agenata (svaki sljedeći se pokreće kad prethodni uspije). */
export const TJEDNI_LANAC = ['konkurencija', 'koordinator'];
