/* Financije iz podataka koje ploča već ima: ponude i uplate iz Parre (prihod po mjesecu isporuke) i trošak agenata.
 * Troškovi obrta (izvodi banke) još nisu spojeni; dok ne budu, dobit se ne računa i ploča to jasno kaže. */
import { ponudaIzReda } from './parra.js';
import { datumZagreb } from './index.js';

const PRIHOD = ['prihvacena', 'racun', 'djelomicno', 'placeno'];
const MJ = ['sij', 'velj', 'ožu', 'tra', 'svi', 'lip', 'srp', 'kol', 'ruj', 'lis', 'stu', 'pro'];
const zaokruzi = (x) => Math.round((Number(x) || 0) * 100) / 100;

/** Posljednjih `n` mjeseci (YYYY-MM), najstariji prvi. */
export function mjeseci(danas, n = 6) {
  const [g, m] = danas.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(g, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** Izračun bez baze: ponude (oblik ponudaIzReda) i trošak agenata po mjesecu → brojke za ekran. */
export function izracunajFinancije(ponude, troskoviAgenata, danas, n = 6, popis = null) {
  const lista = popis || mjeseci(danas, n);
  const mj = Object.fromEntries(lista.map((m) => [m, { mjesec: m, naziv: MJ[+m.slice(5) - 1], prihod: 0, naplaceno: 0, sivanje: 0, igraonica: 0, ponuda: 0, agenti: 0 }]));
  let cekaUplatu = 0, racunaOtvoreno = 0, bezRacuna = 0, bezRacunaIznos = 0;
  for (const p of ponude) {
    if (!PRIHOD.includes(p.stanje)) continue;
    const otvoreno = (p.za_platiti || 0) - (p.placeno || 0);
    if (p.racuni?.length && otvoreno > 0.005) { cekaUplatu += otvoreno; racunaOtvoreno++; }
    const kraj = p.isporuka_do || p.isporuka_od;
    if (kraj && kraj < danas && !p.racuni?.length) { bezRacuna++; bezRacunaIznos += p.iznos || 0; }
    const m = (p.isporuka_od || '').slice(0, 7);
    if (!mj[m]) continue;
    mj[m].prihod += p.iznos || 0;
    mj[m].naplaceno += p.placeno || 0;
    mj[m][p.usluga === 'igraonica' ? 'igraonica' : 'sivanje'] += p.iznos || 0;
    mj[m].ponuda++;
  }
  for (const t of troskoviAgenata) if (mj[t.mjesec]) mj[t.mjesec].agenti += t.usd || 0;
  const redovi = lista.map((m) => ({ ...mj[m], prihod: zaokruzi(mj[m].prihod), naplaceno: zaokruzi(mj[m].naplaceno), sivanje: zaokruzi(mj[m].sivanje), igraonica: zaokruzi(mj[m].igraonica), agenti: zaokruzi(mj[m].agenti) }));
  const ovaj = redovi[redovi.length - 1], prosli = redovi[redovi.length - 2] || null;
  return {
    danas, mjeseci: redovi, ovaj, prosli,
    promjena: prosli && prosli.prihod ? Math.round((ovaj.prihod - prosli.prihod) / prosli.prihod * 100) : null,
    cekaUplatu: zaokruzi(cekaUplatu), racunaOtvoreno, bezRacuna, bezRacunaIznos: zaokruzi(bezRacunaIznos),
  };
}

const MJESEC = /^\d{4}-(0[1-9]|1[0-2])$/;
const dodajMjeseci = (mj, k) => { const [g, m] = mj.split('-').map(Number); return new Date(Date.UTC(g, m - 1 + k, 1)).toISOString().slice(0, 7); };
const razlikaMjeseci = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5) - +a.slice(5));
const NAJVISE_MJESECI = 24;

/**
 * Razdoblje iz upita: `mjeseci=3|6|12` (zadnjih N mjeseci do tekućeg) ili `od=YYYY-MM&do=YYYY-MM`. Bez upita: 6 mjeseci kao do sada.
 * Prihod se vodi po mjesecu isporuke, pa su razdoblja cijeli mjeseci. Baca Error s porukom za neispravan unos.
 */
export function razdobljeFinancija(upit = {}, danas) {
  const tekuci = danas.slice(0, 7);
  if (upit.od || upit.do) {
    const od = String(upit.od || ''), doM = String(upit.do || tekuci);
    if (!MJESEC.test(od) || !MJESEC.test(doM)) throw new Error('Razdoblje: od i do kao YYYY-MM');
    if (od > doM) throw new Error('Početak razdoblja mora biti prije kraja');
    if (doM > tekuci) throw new Error('Razdoblje ne može završiti u budućnosti');
    const n = razlikaMjeseci(od, doM) + 1;
    if (n > NAJVISE_MJESECI) throw new Error(`Razdoblje: najviše ${NAJVISE_MJESECI} mjeseci`);
    return { od, do: doM, n };
  }
  const n = upit.mjeseci == null ? 6 : Number(upit.mjeseci);
  if (!Number.isInteger(n) || n < 1 || n > NAJVISE_MJESECI) throw new Error(`Razdoblje: 1 do ${NAJVISE_MJESECI} mjeseci`);
  return { od: dodajMjeseci(tekuci, -(n - 1)), do: tekuci, n };
}
const popisMjeseci = (od, n) => Array.from({ length: n }, (_, i) => dodajMjeseci(od, i));
const zbrojiRedove = (redovi) => ({
  prihod: zaokruzi(redovi.reduce((s, m) => s + m.prihod, 0)), naplaceno: zaokruzi(redovi.reduce((s, m) => s + m.naplaceno, 0)),
  sivanje: zaokruzi(redovi.reduce((s, m) => s + m.sivanje, 0)), igraonica: zaokruzi(redovi.reduce((s, m) => s + m.igraonica, 0)),
  agenti: zaokruzi(redovi.reduce((s, m) => s + m.agenti, 0)), ponuda: redovi.reduce((s, m) => s + m.ponuda, 0),
});

/** Sve za zaslon Financije i brojke na Pregledu. `upit`: razdoblje (vidi razdobljeFinancija). */
export async function pregledFinancija(env, tenant, sada = new Date(), upit = {}) {
  const danas = datumZagreb(sada), r = razdobljeFinancija(upit, danas);
  const prethodniOd = dodajMjeseci(r.od, -r.n);
  const [ponude, agenti, sink] = await Promise.all([
    env.DB.prepare(`SELECT * FROM parra_ponude WHERE tenant_id = ?`).bind(tenant).all().then((x) => x.results.map(ponudaIzReda)),
    env.DB.prepare(`SELECT substr(kreirano, 1, 7) AS mjesec, SUM(trosak_usd) AS usd FROM pokretanja WHERE tenant_id = ? AND kreirano >= ? GROUP BY mjesec`)
      .bind(tenant, `${prethodniOd}-01`).all().then((x) => x.results),
    env.DB.prepare(`SELECT zadnje_uspjesno, greska FROM parra_sinkronizacija WHERE tenant_id = ?`).bind(tenant).first(),
  ]);
  const izr = izracunajFinancije(ponude, agenti, danas, r.n, popisMjeseci(r.od, r.n));
  const prije = izracunajFinancije(ponude, agenti, danas, r.n, popisMjeseci(prethodniOd, r.n));
  // Najraniji mjesec isporuke koji ploča ima: ako prethodno razdoblje počinje prije njega, usporedba bi bila nepotpuna.
  const prviMjesec = ponude.map((p) => (p.isporuka_od || '').slice(0, 7)).filter((m) => MJESEC.test(m)).sort()[0] || null;
  return {
    ...izr,
    razdoblje: { od: r.od, do: r.do, n: r.n, ...zbrojiRedove(izr.mjeseci) },
    prethodno: prviMjesec && prethodniOd >= prviMjesec ? { od: prethodniOd, do: dodajMjeseci(r.od, -1), ...zbrojiRedove(prije.mjeseci) } : null,
    prviMjesec,
    parra: sink ? { spojeno: true, zadnjeUspjesno: sink.zadnje_uspjesno, greska: sink.greska } : { spojeno: false },
    troskovi: { spojeno: false, izvor: 'Google Drive: izvodi banke' },
  };
}
