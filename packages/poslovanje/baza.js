/* Čitanje podataka faze B iz D1. Koriste ga dashboard (API) i MCP (alati za agente Planer i Skladište). */
import {
  norme as izracunajNorme, OPIS_NORMI, ZADANE_NORME, STANJA, NAZIV_STANJA,
  potrosnjaNarudzbe, stanjeSkladista, kalendarTjedna, kalendarMjeseca, upozorenja, datumZagreb, NAZIV_PONUDE,
} from './index.js';
import { ponudaIzReda } from './parra.js';

const parse = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };

export const narudzbaIzReda = (r) => ({
  id: r.id, sifra: r.sifra, usluga: r.usluga, opis: r.opis, stanje: r.stanje, rok: r.rok,
  termin_od: r.termin_od, termin_do: r.termin_do, opcija_do: r.opcija_do, izrada: parse(r.izrada_json) || [],
  sati_procjena: r.sati_procjena, dostava: r.dostava, vrijednost_eur: r.vrijednost_eur, sifra_racuna: r.sifra_racuna,
  stavke: parse(r.stavke_json) || [], napomena: r.napomena, kreirano: r.kreirano, azurirano: r.azurirano, version: r.version,
});

export async function ucitaj(env, tenant) {
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).all().then((x) => x.results);
  const granica = new Date(Date.now() - 120 * 86400000).toISOString();
  const [artikli, kretanja, narudzbe, normeRedovi] = await Promise.all([
    q(`SELECT * FROM artikli WHERE tenant_id = ? AND aktivno = 1 ORDER BY red, id`, tenant),
    q(`SELECT artikl_id, vrsta, kolicina, kad FROM skladiste_kretanja WHERE tenant_id = ?`, tenant),
    q(`SELECT * FROM narudzbe WHERE tenant_id = ? AND (stanje NOT IN ('isporuceno','odradjeno','otkazano') OR azurirano >= ?)
       ORDER BY COALESCE(rok, substr(termin_od, 1, 10)), sifra`, tenant, granica),
    q(`SELECT kljuc, vrijednost FROM norme WHERE tenant_id = ?`, tenant),
  ]);
  return { artikli: artikli.map(({ tenant_id, ...a }) => a), kretanja, narudzbe: narudzbe.map(narudzbaIzReda), n: izracunajNorme(normeRedovi) };
}

/** Ponude iz Parre koje još nešto znače za kalendar (isporuka unazad 120 dana ili bez datuma) i stanje sinkronizacije. */
async function ucitajPonude(env, tenant) {
  const granica = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const [redovi, sink] = await Promise.all([
    env.DB.prepare(`SELECT * FROM parra_ponude WHERE tenant_id = ? AND (isporuka_od IS NULL OR COALESCE(isporuka_do, isporuka_od) >= ?)
      ORDER BY isporuka_od, broj`).bind(tenant, granica).all().then((x) => x.results),
    env.DB.prepare(`SELECT zadnje, zadnje_uspjesno, greska, ponuda FROM parra_sinkronizacija WHERE tenant_id = ?`).bind(tenant).first(),
  ]);
  return { ponude: redovi.map(ponudaIzReda), sink };
}

/** Sve za zaslone Kalendar i Skladište (i za agente) u jednom pozivu.
 * `od` je bilo koji dan tjedna (ili mjeseca); `pogled` je 'tjedan' (zadano) ili 'mjesec'. */
export async function pregled(env, tenant, od, pogled = 'tjedan') {
  const [{ artikli, kretanja, narudzbe, n }, { ponude, sink }] = await Promise.all([ucitaj(env, tenant), ucitajPonude(env, tenant)]);
  const sada = new Date();
  const skladiste = stanjeSkladista(artikli, kretanja, narudzbe, n, sada);
  const dan = /^\d{4}-\d{2}-\d{2}$/.test(od || '') ? od : datumZagreb(sada);
  return {
    danas: datumZagreb(sada),
    norme: n, opisNormi: OPIS_NORMI, zadaneNorme: ZADANE_NORME, stanja: STANJA, nazivStanja: NAZIV_STANJA,
    narudzbe: narudzbe.map((x) => ({ ...x, potrosnja: x.usluga === 'sivanje' ? potrosnjaNarudzbe(x, n) : null })),
    kalendar: pogled === 'mjesec' ? kalendarMjeseca(narudzbe, dan, n, ponude) : kalendarTjedna(narudzbe, dan, n, ponude),
    ponude: ponude.filter((p) => !['odbijena', 'istekla'].includes(p.stanje)),
    nazivPonude: NAZIV_PONUDE,
    parra: sink ? { spojeno: true, zadnje: sink.zadnje, zadnjeUspjesno: sink.zadnje_uspjesno, greska: sink.greska, ukupno: sink.ponuda } : { spojeno: false },
    skladiste,
    upozorenja: upozorenja(narudzbe, skladiste, n, sada, ponude),
  };
}
