// Definicije agenata za izvršitelj. Tekst uputa je u .md datotekama (Wrangler ih učitava kao tekst).
// `web`: što agent smije na webu (server alati Claude API-ja): true = pretraga i dohvat stranica,
//        'dohvat' = samo čitanje poznatih stranica, 'pretraga' = samo pretraga, false = ništa.
// Alate ploče određuje token agenta (scripts/novi-token.mjs, PRESETI), ne ova datoteka.
// `model` i `effort`: koordinator razgovara s vlasnikom i raspoređuje posao (Opus); ostali rade na zadanom modelu
// izvršitelja (env.MODEL, Sonnet) da bi bili jeftiniji. Mijenja se varijablama MODEL_KOORDINATOR i EFFORT_KOORDINATOR.
import konkurencija from './konkurencija.md';
import koordinator from './koordinator.md';
import seo from './seo.md';
import ai from './ai.md';
import sadrzaj from './sadrzaj.md';
import lokalno from './lokalno.md';
import oglasi from './oglasi.md';

export const AGENTI = {
  konkurencija: { naziv: 'Konkurencija', prompt: konkurencija, web: true, maxKoraka: 25 },
  seo: { naziv: 'SEO', prompt: seo, web: 'dohvat', maxKoraka: 25 },
  ai: { naziv: 'AI vidljivost', prompt: ai, web: true, maxKoraka: 25 },
  sadrzaj: { naziv: 'Sadržaj', prompt: sadrzaj, web: 'dohvat', maxKoraka: 20 },
  lokalno: { naziv: 'Lokalno i recenzije', prompt: lokalno, web: true, maxKoraka: 25 },
  oglasi: { naziv: 'Oglasi', prompt: oglasi, web: false, maxKoraka: 15 },
  koordinator: { naziv: 'Koordinator', prompt: koordinator, web: false, maxKoraka: 15, model: 'claude-opus-5-5', effort: 'medium' },
};

/** Pregledi: redoslijed agenata (svaki sljedeći se pokreće kad prethodni uspije). Oglasi tek od Faze 3. */
export const LANCI = {
  tjedni: ['konkurencija', 'koordinator'],
  mjesecni: ['konkurencija', 'seo', 'ai', 'sadrzaj', 'lokalno', 'koordinator'],
};
