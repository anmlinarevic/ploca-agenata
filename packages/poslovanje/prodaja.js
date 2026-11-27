/* Prodaja po razdoblju: upiti (tjedni ručni unos, s izvorima) i ponude iz Parre. Podaci o upitima postoje samo po tjednima,
 * pa se razdoblje računa u cijelim tjednima (ponedjeljak do nedjelje); izabrano razdoblje se zaokružuje i ploča kaže na što.
 * Čiste funkcije bez baze + jedan upit nad bazom. Koristi i ekran Prodaja i lijevak „Od mreža do novca” na Pregledu. */
import { ponudaIzReda } from './parra.js';
import { datumZagreb } from './index.js';

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const PRIHOD = ['prihvacena', 'racun', 'djelomicno', 'placeno'];
export const IZVORI = ['instagram', 'facebook', 'tiktok', 'google', 'ai', 'preporuka', 'ostalo'];

const dodajDane = (iso, k) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const razlikaDana = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const dan = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = ponedjeljak
const brojOd = (v) => (Number.isFinite(+v) ? +v : 0);
const zaokruzi = (x) => Math.round((Number(x) || 0) * 100) / 100;

/**
 * Razdoblje iz upita: `dana=N` (zadnjih N dana do kraja zadnjeg završenog tjedna) ili `od` i `do` (YYYY-MM-DD, najviše do jučer).
 * Najmanje 7 dana (jedan cijeli tjedan), najviše 366. Baca Error s porukom za neispravan unos.
 */
export function razdobljeProdaje(upit = {}, danas) {
  const jucer = dodajDane(danas, -1);
  if (upit.od || upit.do) {
    const od = String(upit.od || ''), doD = String(upit.do || jucer);
    if (!DATUM.test(od) || !DATUM.test(doD)) throw new Error('Razdoblje: od i do kao YYYY-MM-DD');
    if (od > doD) throw new Error('Početak razdoblja mora biti prije kraja');
    if (doD > jucer) throw new Error('Razdoblje može završiti najkasnije jučer');
    const dana = razlikaDana(od, doD) + 1;
    if (dana < 7) throw new Error('Razdoblje: najmanje 7 dana (upiti se upisuju tjedno)');
    if (dana > 366) throw new Error('Razdoblje: najviše 366 dana');
    return { od, do: doD, dana, prilagodeno: true };
  }
  const dana = upit.dana == null ? 28 : Number(upit.dana);
  if (!Number.isInteger(dana) || dana < 7 || dana > 366) throw new Error('Razdoblje: 7 do 366 dana');
  const kraj = dan(jucer) === 6 ? jucer : dodajDane(jucer, -(dan(jucer) + 1)); // zadnja završena nedjelja
  return { od: dodajDane(kraj, -(dana - 1)), do: kraj, dana, prilagodeno: false };
}

/** Cijeli tjedni (ponedjeljak do nedjelje) koji su u cijelosti unutar razdoblja. `tjedni`: redovi s poljem `od` (ponedjeljak). */
export const tjedniUnutar = (tjedni, od, doD) => tjedni.filter((t) => t.od && DATUM.test(t.od) && t.od >= od && dodajDane(t.od, 6) <= doD && dan(t.od) === 0)
  .sort((a, b) => (a.od < b.od ? -1 : 1));

/** Zbroj upita iz tjednih redova (izvori_json je objekt { izvor: broj }). */
export function zbrojUpita(redovi) {
  const iz = Object.fromEntries(IZVORI.map((i) => [i, 0]));
  let banner = 0, igraonica = 0;
  for (const t of redovi) {
    banner += brojOd(t.upiti_banner); igraonica += brojOd(t.upiti_igraonica);
    let j = {}; try { j = JSON.parse(t.izvori_json || '{}') || {}; } catch { /* prazno */ }
    for (const i of IZVORI) iz[i] += brojOd(j[i]);
  }
  return { n: banner + igraonica, banner, igraonica, izvori: iz };
}

function zbrojPonuda(ponude) {
  const poStanju = {};
  for (const p of ponude) { const x = (poStanju[p.stanje] ||= { n: 0, iznos: 0 }); x.n++; x.iznos += p.iznos || 0; }
  const iznos = (l) => zaokruzi(l.reduce((s, p) => s + (p.iznos || 0), 0));
  const prihv = ponude.filter((p) => PRIHOD.includes(p.stanje)), plac = ponude.filter((p) => p.stanje === 'placeno');
  for (const k of Object.keys(poStanju)) poStanju[k].iznos = zaokruzi(poStanju[k].iznos);
  return { poslane: { n: ponude.length, iznos: iznos(ponude) }, poStanju, prihvacene: { n: prihv.length, iznos: iznos(prihv) }, placene: { n: plac.length, iznos: iznos(plac) } };
}

/** Izračun bez baze: tjedni (redovi iz tablice tjedni) i ponude (oblik ponudaIzReda). */
export function izracunajProdaju({ tjedni, ponude }, upit, danas) {
  const r = razdobljeProdaje(upit, danas);
  // Razdoblje se zaokružuje na cijele tjedne (ponedjeljak do nedjelje) koji stanu u njega, neovisno o tome je li za njih nešto upisano.
  const m0 = dodajDane(r.od, (7 - dan(r.od)) % 7);
  const ocekivano = dodajDane(m0, 6) <= r.do ? Math.floor((razlikaDana(m0, r.do) - 6) / 7) + 1 : 0;
  const snap = ocekivano ? { od: m0, do: dodajDane(m0, ocekivano * 7 - 1) } : { od: r.od, do: r.do };
  const unutra = tjedniUnutar(tjedni, snap.od, snap.do);
  const prviTjedan = tjedni.map((t) => t.od).filter((o) => o && DATUM.test(o)).sort()[0] || null;
  const prvaPonuda = ponude.map((p) => p.datum_ponude).filter((d) => d && DATUM.test(d)).sort()[0] || null;
  const upiti = zbrojUpita(unutra);
  const ponudeU = ponude.filter((p) => p.datum_ponude && p.datum_ponude >= snap.od && p.datum_ponude <= snap.do);
  const zp = zbrojPonuda(ponudeU);

  const duljina = (ocekivano || 1) * 7;
  const pOd = dodajDane(snap.od, -duljina), pDo = dodajDane(snap.od, -1);
  const prethodniTjedni = tjedniUnutar(tjedni, pOd, pDo);
  const imaPrethodno = !!prviTjedan && pOd >= prviTjedan && ocekivano > 0;
  const prethodno = imaPrethodno ? {
    od: pOd, do: pDo, tjedana: prethodniTjedni.length, upiti: zbrojUpita(prethodniTjedni),
    ponude: zbrojPonuda(ponude.filter((p) => p.datum_ponude && p.datum_ponude >= pOd && p.datum_ponude <= pDo)),
    ponudeDostupne: !!prvaPonuda && pOd >= prvaPonuda,
  } : null;

  return {
    danas,
    razdoblje: { od: snap.od, do: snap.do, dana: razlikaDana(snap.od, snap.do) + 1, tjedana: unutra.length, ocekivano, zatrazeno: { od: r.od, do: r.do, dana: r.dana } },
    upiti, ponude: zp,
    upitiUPonudu: upiti.n ? Math.round(zp.poslane.n / upiti.n * 100) : null,
    niz: unutra.map((t) => ({ od: t.od, upiti: brojOd(t.upiti_banner) + brojOd(t.upiti_igraonica), banner: brojOd(t.upiti_banner), igraonica: brojOd(t.upiti_igraonica) })),
    prethodno, prviTjedan, prvaPonuda,
  };
}

/** Sve za ekran Prodaja i lijevak na Pregledu. `upit`: { dana } ili { od, do }. */
export async function pregledProdaje(env, tenant, sada = new Date(), upit = {}) {
  const danas = datumZagreb(sada), db = env.DB;
  const [tjedni, ponude, sink] = await Promise.all([
    db.prepare(`SELECT tjedan, od, upiti_banner, upiti_igraonica, izvori_json FROM tjedni WHERE tenant_id = ? ORDER BY od`).bind(tenant).all().then((x) => x.results),
    db.prepare(`SELECT * FROM parra_ponude WHERE tenant_id = ?`).bind(tenant).all().then((x) => x.results.map(ponudaIzReda)),
    db.prepare(`SELECT zadnje_uspjesno, greska FROM parra_sinkronizacija WHERE tenant_id = ?`).bind(tenant).first(),
  ]);
  const izr = izracunajProdaju({ tjedni, ponude }, upit, danas);
  // Doseg društvenih mreža za isto razdoblje: samo ako dnevne brojke pokrivaju cijelo razdoblje na svakom Meta računu.
  const { od, do: doD, dana } = izr.razdoblje;
  const racuni = (await db.prepare(`SELECT id FROM racuni WHERE tenant_id = ? AND aktivan = 1 AND mreza IN ('facebook', 'instagram')`).bind(tenant).all()).results;
  let doseg = null;
  if (racuni.length) {
    const redovi = (await db.prepare(`SELECT racun_id, SUM(vrijednost) AS v, COUNT(DISTINCT datum) AS n FROM brojke_dan WHERE tenant_id = ? AND mjera = 'doseg' AND datum >= ? AND datum <= ? GROUP BY racun_id`).bind(tenant, od, doD).all()).results;
    const pokriveno = Math.min(...racuni.map((r) => redovi.find((x) => x.racun_id === r.id)?.n ?? 0));
    doseg = { vrijednost: pokriveno >= dana ? redovi.reduce((s, x) => s + x.v, 0) : null, pokriveno, dana, zbrojDana: true };
  }
  return { ...izr, doseg, parra: sink ? { spojeno: true, zadnjeUspjesno: sink.zadnje_uspjesno, greska: sink.greska } : { spojeno: false } };
}
