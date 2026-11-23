/* Čitanje podataka faze B iz D1. Koriste ga dashboard (API) i MCP (alati za agente Planer i Skladište). */
import {
  norme as izracunajNorme, OPIS_NORMI, ZADANE_NORME, STANJA, NAZIV_STANJA,
  potrosnjaNarudzbe, stanjeSkladista, kalendarTjedna, upozorenja, datumZagreb,
} from './index.js';

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

/** Sve za zaslone Kalendar i Skladište (i za agente) u jednom pozivu. `od` je bilo koji dan tjedna. */
export async function pregled(env, tenant, od) {
  const { artikli, kretanja, narudzbe, n } = await ucitaj(env, tenant);
  const sada = new Date();
  const skladiste = stanjeSkladista(artikli, kretanja, narudzbe, n, sada);
  return {
    danas: datumZagreb(sada),
    norme: n, opisNormi: OPIS_NORMI, zadaneNorme: ZADANE_NORME, stanja: STANJA, nazivStanja: NAZIV_STANJA,
    narudzbe: narudzbe.map((x) => ({ ...x, potrosnja: x.usluga === 'sivanje' ? potrosnjaNarudzbe(x, n) : null })),
    kalendar: kalendarTjedna(narudzbe, /^\d{4}-\d{2}-\d{2}$/.test(od || '') ? od : datumZagreb(sada), n),
    skladiste,
    upozorenja: upozorenja(narudzbe, skladiste, n, sada),
  };
}
