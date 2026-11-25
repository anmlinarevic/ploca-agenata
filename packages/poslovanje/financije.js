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
export function izracunajFinancije(ponude, troskoviAgenata, danas, n = 6) {
  const lista = mjeseci(danas, n);
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

/** Sve za zaslon Financije i brojke na Pregledu. */
export async function pregledFinancija(env, tenant, sada = new Date()) {
  const danas = datumZagreb(sada);
  const od = `${mjeseci(danas, 6)[0]}-01`;
  const [ponude, agenti, sink] = await Promise.all([
    env.DB.prepare(`SELECT * FROM parra_ponude WHERE tenant_id = ?`).bind(tenant).all().then((x) => x.results.map(ponudaIzReda)),
    env.DB.prepare(`SELECT substr(kreirano, 1, 7) AS mjesec, SUM(trosak_usd) AS usd FROM pokretanja WHERE tenant_id = ? AND kreirano >= ? GROUP BY mjesec`)
      .bind(tenant, od).all().then((x) => x.results),
    env.DB.prepare(`SELECT zadnje_uspjesno, greska FROM parra_sinkronizacija WHERE tenant_id = ?`).bind(tenant).first(),
  ]);
  return {
    ...izracunajFinancije(ponude, agenti, danas),
    parra: sink ? { spojeno: true, zadnjeUspjesno: sink.zadnje_uspjesno, greska: sink.greska } : { spojeno: false },
    troskovi: { spojeno: false, izvor: 'Google Drive: izvodi banke' },
  };
}
