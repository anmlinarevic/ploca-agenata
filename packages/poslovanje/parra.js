/* Čitanje ponuda i plaćanja iz Parre (https://api.parra.hr/docs, API v1.1). Samo GET: ploča ništa ne mijenja u Parri.
 * Ključ i id poslovnog subjekta su tajne Workera (PARRA_API_KLJUC, PARRA_SUBJEKT); ključ nikad ne ide u bazu ni pregledniku.
 * Na ploču ne ulaze ime kupca, OIB, adresa, kontakt ni opisi stavki: samo broj ponude, status, datumi, iznosi i nazivi stavki. */
import { stanjePonude, uslugaPonude } from './index.js';

const OSNOVA = 'https://api.parra.hr';
const STRANICA = 50;
// Free plan Workersa dopušta 50 podzahtjeva po pozivu; ostavljamo rezervu. Ostatak dolazi u idućem krugu.
const NAJVISE_ZAHTJEVA = 40;
const POCETAK = '2024-01-01T00:00:00Z';

const parse = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };
const dan = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
// Parra šalje UN/ECE oznake jedinica (iste kao u popisu stavki).
const JEDINICE = { H87: 'kom', C62: 'kom', XKI: 'komplet', SET: 'par', E48: 'usluga', HUR: 'h', KMT: 'km', MTR: 'm', MTK: 'm²', KGM: 'kg', DAY: 'dan' };
const jedinica = (j) => (j ? JEDINICE[String(j).toUpperCase()] || String(j).toLowerCase() : null);
const bezKontakta =(s) => String(s || '').replace(/\S+@\S+/g, '…').replace(/\+?\d[\d\s/-]{7,}\d/g, '…').trim().slice(0, 80);

/** Je li Parra podešena za ovog zakupca (tajne postoje, zakupac je onaj iz PARRA_ZAKUPAC). */
export const parraPodesena = (env, tenant) =>
  !!(env.PARRA_API_KLJUC && env.PARRA_SUBJEKT && (env.PARRA_ZAKUPAC || 'piccolini') === tenant);

/** Red iz baze → oblik za kalendar i ekran. */
export function ponudaIzReda(r) {
  const stavke = parse(r.stavke_json) || [];
  const p = {
    id: r.id, broj: r.broj, status: r.status, datum_ponude: r.datum_ponude, isporuka_od: r.isporuka_od, isporuka_do: r.isporuka_do,
    iznos: r.iznos, valuta: r.valuta, stavke, racuni: parse(r.racuni_json) || [], placeno: r.placeno, za_platiti: r.za_platiti,
    promijenjeno: r.promijenjeno, opis: stavke.length ? stavke[0].naziv + (stavke.length > 1 ? ` + još ${stavke.length - 1}` : '') : null,
  };
  p.stanje = stanjePonude(p);
  p.usluga = uslugaPonude(stavke);
  return p;
}

/** Detalj ponude iz Parre → red za bazu (bez osobnih podataka). */
export function redIzDetalja(d) {
  const b = d.basicInfo || {}, di = d.deliveryInfo || {};
  const od = di.isDeliveryPeriod ? dan(di.deliveryDateFrom) : dan(di.deliveryDate);
  const doD = di.isDeliveryPeriod ? dan(di.deliveryDateTo) : od;
  return {
    id: d.id, broj: String(b.offerNumber || d.id), status: d.status?.name || 'Issued', datum_ponude: dan(b.offerDate),
    isporuka_od: od || doD, isporuka_do: doD || od, iznos: d.totalAmount ?? null, valuta: b.currencyMark || 'EUR',
    stavke: (d.offerLines || []).slice(0, 12).map((l) => ({ naziv: bezKontakta(l.name), kolicina: l.quantity ?? null, jedinica: jedinica(l.unitOfMeasureMark) })),
    racuni: (d.invoices || []).map((i) => ({ id: i.invoiceId, broj: i.invoiceNumber, status: i.status?.name || null })),
    promijenjeno: d.modifiedOn || d.createdOn || null,
  };
}

class GreskaParre extends Error {}

function klijent(env, fetchFn) {
  const osnova = (env.PARRA_URL || OSNOVA).replace(/\/$/, '');
  const subjekt = encodeURIComponent(String(env.PARRA_SUBJEKT).trim());
  let zahtjeva = 0;
  const get = async (put, upit = {}) => {
    if (zahtjeva >= NAJVISE_ZAHTJEVA) return null;
    zahtjeva++;
    const qs = new URLSearchParams(Object.entries(upit).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]));
    const q = qs.toString();
    const odg = await fetchFn(`${osnova}/v1.1/${subjekt}${put}${q ? `?${q}` : ''}`, {
      headers: { authorization: `Bearer ${String(env.PARRA_API_KLJUC).trim()}`, accept: 'application/json' },
    });
    if (odg.status === 404) return { nema: true };
    if (odg.status === 401) throw new GreskaParre('Parra ne prihvaća ključ (istekao, opozvan ili paket bez API pristupa). Upiši novi ključ.');
    if (odg.status === 403) throw new GreskaParre('Ključ nema pristup tom poslovnom subjektu. Provjeri PARRA_SUBJEKT.');
    if (odg.status === 429) throw new GreskaParre('Parra je privremeno ograničila broj zahtjeva. Nastavlja se u idućem krugu.');
    if (!odg.ok) throw new GreskaParre(`Parra je vratila grešku ${odg.status}.`);
    return odg.json();
  };
  return { get, iskoristeno: () => zahtjeva, ima: () => zahtjeva < NAJVISE_ZAHTJEVA };
}

/** Jedan krug sinkronizacije: promijenjene ponude (delta) pa uplate po računima. Vraća sažetak za ekran. */
export async function sinkronizirajParru(env, tenant, { fetchFn = fetch, sada = () => new Date().toISOString() } = {}) {
  if (!parraPodesena(env, tenant)) return { ok: false, greska: 'Parra nije spojena za ovog zakupca.' };
  const db = env.DB;
  const st = (await db.prepare(`SELECT * FROM parra_sinkronizacija WHERE tenant_id = ?`).bind(tenant).first()) || {};
  let kursor = { kad: st.kursor_kad || POCETAK, id: st.kursor_id ?? null };
  const k = klijent(env, fetchFn);
  let promijenjeno = 0, gotovo = false, greska = null;

  const spremi = (r) => db.prepare(`INSERT INTO parra_ponude (tenant_id, id, broj, status, datum_ponude, isporuka_od, isporuka_do, iznos, valuta,
      stavke_json, racuni_json, promijenjeno, sinkronizirano) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (tenant_id, id) DO UPDATE SET broj = excluded.broj, status = excluded.status, datum_ponude = excluded.datum_ponude,
      isporuka_od = excluded.isporuka_od, isporuka_do = excluded.isporuka_do, iznos = excluded.iznos, valuta = excluded.valuta,
      stavke_json = excluded.stavke_json, racuni_json = excluded.racuni_json, promijenjeno = excluded.promijenjeno, sinkronizirano = excluded.sinkronizirano`)
    .bind(tenant, r.id, r.broj, r.status, r.datum_ponude, r.isporuka_od, r.isporuka_do, r.iznos, r.valuta,
      JSON.stringify(r.stavke), JSON.stringify(r.racuni), r.promijenjeno, sada());

  try {
    // 1) ponude promijenjene od zadnjeg puta, najstarija promjena prva
    stranice: while (k.ima()) {
      const popis = await k.get('/offers', { UpdatedSince: kursor.kad, AfterId: kursor.id, pageSize: STRANICA });
      if (!popis || popis.nema) break;
      const redovi = popis.data || [];
      for (const o of redovi) {
        if (!k.ima()) break stranice;
        const d = await k.get(`/offers/${o.id}`);
        if (!d) break stranice;
        if (d.nema) await db.prepare(`DELETE FROM parra_ponude WHERE tenant_id = ? AND id = ?`).bind(tenant, o.id).run();
        else await spremi(redIzDetalja(d.data ?? d)).run();
        kursor = { kad: o.modifiedOn || o.createdOn, id: o.id };
        promijenjeno++;
      }
      if (redovi.length < STRANICA) { gotovo = true; break; }
    }

    // 2) uplate: računi iz ponuda koji još nisu plaćeni do kraja (popis računa nosi paidAmount)
    const otvoreni = (await db.prepare(`SELECT id, racuni_json, placeno, za_platiti FROM parra_ponude
        WHERE tenant_id = ? AND racuni_json != '[]' AND (za_platiti IS NULL OR placeno IS NULL OR placeno < za_platiti - 0.005)`).bind(tenant).all()).results
      .map((r) => ({ id: r.id, racuni: (parse(r.racuni_json) || []).map((x) => x.id) }));
    const trazeni = new Set(otvoreni.flatMap((o) => o.racuni));
    const nadjeni = new Map();
    if (trazeni.size) {
      const odDatuma = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
      for (let str = 1; str <= 8 && k.ima() && nadjeni.size < trazeni.size; str++) {
        const r = await k.get('/invoices', { DateFrom: odDatuma, page: str, pageSize: STRANICA });
        if (!r || r.nema) break;
        for (const i of r.data || []) if (trazeni.has(i.id)) nadjeni.set(i.id, i);
        if ((r.data || []).length < STRANICA) break;
      }
      const naredbe = [];
      for (const o of otvoreni) {
        const racuni = o.racuni.map((id) => nadjeni.get(id)).filter(Boolean).filter((i) => !/cancel|storn/i.test(i.status || ''));
        if (!racuni.length) continue;
        const placeno = racuni.reduce((s, i) => s + (+i.paidAmount || 0), 0), ukupno = racuni.reduce((s, i) => s + (+i.totalAmount || 0), 0);
        naredbe.push(db.prepare(`UPDATE parra_ponude SET placeno = ?, za_platiti = ? WHERE tenant_id = ? AND id = ?`)
          .bind(Math.round(placeno * 100) / 100, Math.round(ukupno * 100) / 100, tenant, o.id));
      }
      if (naredbe.length) await db.batch(naredbe);
    }
  } catch (e) {
    if (!(e instanceof GreskaParre)) console.error('parra', e);
    greska = e instanceof GreskaParre ? e.message : 'Veza s Parrom nije uspjela. Pokušat će ponovno za 30 minuta.';
  }

  const ukupno = (await db.prepare(`SELECT COUNT(*) AS c FROM parra_ponude WHERE tenant_id = ?`).bind(tenant).first()).c;
  const kad = sada();
  await db.prepare(`INSERT INTO parra_sinkronizacija (tenant_id, kursor_kad, kursor_id, zadnje, zadnje_uspjesno, greska, ponuda)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (tenant_id) DO UPDATE SET kursor_kad = excluded.kursor_kad, kursor_id = excluded.kursor_id, zadnje = excluded.zadnje,
      zadnje_uspjesno = COALESCE(excluded.zadnje_uspjesno, parra_sinkronizacija.zadnje_uspjesno), greska = excluded.greska, ponuda = excluded.ponuda`)
    .bind(tenant, kursor.kad, kursor.id, kad, greska ? null : kad, greska, ukupno).run();
  return { ok: !greska, greska, promijenjeno, ukupno, joshIma: !greska && !gotovo, zahtjeva: k.iskoristeno() };
}
