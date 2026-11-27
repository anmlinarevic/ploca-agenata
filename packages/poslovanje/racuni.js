/* Računi na društvenim mrežama: više računa po mreži. Čiste provjere i upiti na bazi; nikad ne dira tuđeg zakupca.
 * Facebook: račun je stranica (vanjski_id = id stranice). Instagram: čita se preko Facebook stranice na koju je povezan (stranica_id),
 * a vanjski_id (id poslovnog računa) upisuje sinkronizacija kad ga pronađe. TikTok: vanjski_id je open_id nakon prijave računa. */

export const MREZE = ['facebook', 'instagram', 'tiktok'];
export const USLUGE = ['banneri', 'igraonica', 'oboje'];
const ID_STRANICE = /^\d{6,20}$/;

const nowIso = () => new Date().toISOString();
const parse = (s) => { try { return s == null ? [] : JSON.parse(s); } catch { return []; } };

/** Provjera unosa novog računa. Baca Error s porukom na hrvatskom; vraća očišćene vrijednosti. */
export function provjeriRacun(b = {}) {
  const mreza = b.mreza;
  if (!MREZE.includes(mreza)) throw new Error(`mreza mora biti: ${MREZE.join(', ')}`);
  const usluga = b.usluga ?? 'oboje';
  if (!USLUGE.includes(usluga)) throw new Error(`usluga mora biti: ${USLUGE.join(', ')}`);
  let naziv = b.naziv == null ? '' : String(b.naziv).trim();
  if (naziv.length > 60) throw new Error('Naziv: najviše 60 znakova');
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(naziv) || /\+?\d[\d\s/-]{7,}\d/.test(naziv)) throw new Error('Naziv: bez e-maila i telefona');
  let stranica = null;
  if (mreza === 'facebook' || mreza === 'instagram') {
    stranica = String(b.id_stranice ?? '').trim();
    if (!ID_STRANICE.test(stranica)) throw new Error('ID Facebook stranice su samo brojke (barem 6). Nalazi se u: Stranica, O stranici, Transparentnost stranice.');
  } else if (!naziv) {
    throw new Error('Za TikTok račun upiši naziv (korisničko ime).');
  }
  if (naziv && naziv.length < 2) throw new Error('Naziv: barem 2 znaka');
  return { mreza, usluga, naziv, stranica };
}

const redRacuna = (r) => ({
  id: r.id, mreza: r.mreza, naziv: r.naziv, usluga: r.usluga, status: r.status,
  vanjskiId: r.vanjski_id, stranicaId: r.stranica_id,
  zadnje: r.zadnje, zadnjeUspjesno: r.zadnje_uspjesno, greska: r.greska, upozorenja: parse(r.upozorenja_json), povijestOd: r.povijest_od,
});

/** Aktivni računi zakupca, po mreži pa po redoslijedu dodavanja. */
export async function popisRacuna(db, tenant, { mreza = null } = {}) {
  const q = `SELECT * FROM racuni WHERE tenant_id = ? AND aktivan = 1 ${mreza ? 'AND mreza = ?' : ''} ORDER BY mreza, kreirano, id`;
  const st = db.prepare(q).bind(...(mreza ? [tenant, mreza] : [tenant]));
  return (await st.all()).results.map(redRacuna);
}

const noviId = (mreza) => `${mreza}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * Dodaje račun. Za Meta račune dodaje i par: Instagram se čita preko stranice pa se uz njega dodaje i Facebook stranica (ako je još nema),
 * a uz Facebook stranicu Instagram pronalazi sinkronizacija. Vraća popis dodanih računa.
 */
export async function dodajRacun(db, tenant, unos) {
  const v = provjeriRacun(unos);
  const sada = nowIso(), dodano = [];
  const postoji = async (mreza, stranica) => (await db.prepare(`SELECT id FROM racuni WHERE tenant_id = ? AND mreza = ? AND stranica_id = ? AND aktivan = 1`).bind(tenant, mreza, stranica).first());
  const naredbe = [];
  const dodaj = (mreza, naziv, rucno, stranica, vanjski, status) => {
    const id = noviId(mreza);
    naredbe.push(db.prepare(`INSERT INTO racuni (id, tenant_id, mreza, naziv, naziv_rucno, usluga, vanjski_id, stranica_id, status, kreirano) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, tenant, mreza, naziv, rucno ? 1 : 0, v.usluga, vanjski, stranica, status, sada));
    dodano.push({ id, mreza, naziv });
  };
  if (v.mreza === 'tiktok') {
    const ime = v.naziv.startsWith('@') ? v.naziv : `@${v.naziv}`;
    const isti = await db.prepare(`SELECT id FROM racuni WHERE tenant_id = ? AND mreza = 'tiktok' AND aktivan = 1 AND lower(naziv) = lower(?)`).bind(tenant, ime).first();
    if (isti) throw new Error('Taj TikTok račun je već dodan.');
    dodaj('tiktok', ime, true, null, null, 'rucno');
  } else {
    const ovaj = await postoji(v.mreza, v.stranica);
    if (ovaj) throw new Error(`Taj ${v.mreza === 'facebook' ? 'Facebook račun' : 'Instagram račun'} je već dodan.`);
    dodaj(v.mreza, v.naziv || (v.mreza === 'facebook' ? `Stranica ${v.stranica.slice(-4)}` : `Instagram ${v.stranica.slice(-4)}`), !!v.naziv, v.stranica, v.mreza === 'facebook' ? v.stranica : null, 'ceka');
    if (v.mreza === 'instagram' && !(await postoji('facebook', v.stranica)))
      dodaj('facebook', `Stranica ${v.stranica.slice(-4)}`, false, v.stranica, v.stranica, 'ceka');
  }
  await db.batch(naredbe);
  return dodano;
}

/** Uklanja račun s ploče (podaci ostaju u bazi). Vraća true ako je račun postojao i bio aktivan. */
export async function ukloniRacun(db, tenant, id) {
  const r = await db.prepare(`UPDATE racuni SET aktivan = 0 WHERE tenant_id = ? AND id = ? AND aktivan = 1`).bind(tenant, id).run();
  return (r.meta?.changes ?? 0) > 0;
}

/**
 * Prijelaz sa stare postavke (jedna stranica u tajni META_STRANICA): ako zakupac nema nijedan aktivan Meta račun, a tajna postoji,
 * stvara se Facebook račun; računi koje je napravila migracija (facebook-1, instagram-1) dobivaju id stranice iz tajne.
 */
export async function osiguraStareRacune(env, tenant) {
  const stranica = String(env.META_STRANICA || '').trim();
  if (!stranica) return;
  const db = env.DB, sada = nowIso();
  const imaStranicu = await db.prepare(`SELECT id FROM racuni WHERE tenant_id = ? AND mreza = 'facebook' AND aktivan = 1 AND stranica_id = ?`).bind(tenant, stranica).first();
  if (imaStranicu) return;
  const bezStranice = (await db.prepare(`SELECT id, mreza FROM racuni WHERE tenant_id = ? AND mreza IN ('facebook', 'instagram') AND aktivan = 1 AND stranica_id IS NULL`).bind(tenant).all()).results;
  const naredbe = [];
  const fb = bezStranice.find((r) => r.mreza === 'facebook'), ig = bezStranice.find((r) => r.mreza === 'instagram');
  if (fb) naredbe.push(db.prepare(`UPDATE racuni SET stranica_id = ?, vanjski_id = ? WHERE tenant_id = ? AND id = ?`).bind(stranica, stranica, tenant, fb.id));
  else {
    // Bez ijednog Meta računa (ni uklonjenog): tek tada se stvara prvi. Uklonjeni račun se ne vraća sam od sebe zbog tajne.
    const bilo = await db.prepare(`SELECT id FROM racuni WHERE tenant_id = ? AND mreza IN ('facebook', 'instagram') LIMIT 1`).bind(tenant).first();
    if (bilo) return;
    naredbe.push(db.prepare(`INSERT INTO racuni (id, tenant_id, mreza, naziv, naziv_rucno, usluga, vanjski_id, stranica_id, status, kreirano) VALUES ('facebook-1', ?, 'facebook', 'Facebook stranica', 0, 'oboje', ?, ?, 'ceka', ?)`).bind(tenant, stranica, stranica, sada));
  }
  if (ig) naredbe.push(db.prepare(`UPDATE racuni SET stranica_id = ? WHERE tenant_id = ? AND id = ?`).bind(stranica, tenant, ig.id));
  await db.batch(naredbe);
}

/**
 * Račun za objavu. S `racunId` mora postojati, biti aktivan i biti račun mreže `kanal`. Bez njega: ako zakupac na toj mreži ima
 * točno jedan aktivan račun, objava ide na njega; ako nema nijednog, vraća se null (mreža bez dodanog računa); ako ih je više,
 * baca grešku koja ih nabraja, da se račun mora izabrati. Vraća id računa ili null.
 */
export async function odrediRacunObjave(db, tenant, kanal, racunId) {
  if (racunId != null && racunId !== '') {
    if (typeof racunId !== 'string' || racunId.length > 60) throw new Error('racun_id: neispravan id');
    const r = await db.prepare(`SELECT id, mreza, naziv FROM racuni WHERE tenant_id = ? AND id = ? AND aktivan = 1`).bind(tenant, racunId).first();
    if (!r) throw new Error(`Račun ${racunId} ne postoji ili je uklonjen (popis: dohvati_racune)`);
    if (r.mreza !== kanal) throw new Error(`Račun ${r.naziv} je ${r.mreza} račun, a objava je za ${kanal}`);
    return r.id;
  }
  const lista = (await db.prepare(`SELECT id, naziv FROM racuni WHERE tenant_id = ? AND mreza = ? AND aktivan = 1 ORDER BY kreirano, id`).bind(tenant, kanal).all()).results;
  if (lista.length === 0) return null;
  if (lista.length === 1) return lista[0].id;
  throw new Error(`Na mreži ${kanal} ima ${lista.length} računa: ${lista.map((x) => `${x.naziv} (${x.id})`).join(', ')}. Navedi racun_id.`);
}
