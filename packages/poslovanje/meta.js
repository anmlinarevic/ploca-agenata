/* Instagram i Facebook stranica preko Meta Graph API-ja. Samo čitanje vlastitih računa: ploča ništa ne objavljuje
 * i ne čita poruke ni komentare. Token i id stranice su tajne Workera (META_TOKEN, META_STRANICA); token ide u
 * zaglavlje (ne u adresu), nikad u bazu ni pregledniku. Instagram poslovni račun pronalazi se preko stranice. */

const OSNOVA = 'https://graph.facebook.com';
const VERZIJA = 'v25.0';
// Free plan Workersa dopušta 50 podzahtjeva po pozivu; ostatak uvida stiže u idućem krugu.
const NAJVISE_ZAHTJEVA = 40;
const DAN = 86400000;
const OSVJEZI_UVIDE_MS = 20 * 3600000;   // uvidi objave najviše jednom u 20 sati
const SVJEZE_DANA = 35;                   // nakon toga se brojke objave više ne osvježavaju

export const SATI = [8, 11, 14, 17, 20, 22];
export const DANI = ['ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota', 'nedjelja'];

/** Je li Meta podešena za ovog zakupca. */
export const metaPodesena = (env, tenant) =>
  !!(env.META_TOKEN && env.META_STRANICA && (env.META_ZAKUPAC || 'piccolini') === tenant);

const datumZg = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb' }).format(d);
const parse = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };
const broj = (v) => (v == null || v === '' || Number.isNaN(+v) ? null : Math.round(+v));

/** Opis objave za ploču: kratko, bez @oznaka, e-mailova i brojeva telefona. */
export const cistiOpis = (s) => String(s || '')
  .replace(/\S+@\S+\.\S+/g, '…').replace(/@[\w.]+/g, '@…').replace(/\+?\d[\d\s/-]{7,}\d/g, '…')
  .replace(/\s+/g, ' ').trim().slice(0, 90) || null;

const vrstaIg = (m) => (m.media_product_type === 'REELS' ? 'reel'
  : m.media_type === 'CAROUSEL_ALBUM' ? 'album' : m.media_type === 'VIDEO' ? 'video' : 'slika');
const vrstaFb = (p) => (/video/.test(p.status_type || '') ? 'video' : /photo/.test(p.status_type || '') ? 'slika' : 'objava');

/** Vrijednost metrike iz odgovora uvida (values[] ili total_value), zbroj ako je objekt (npr. reakcije po vrsti). */
function vrijednost(x, zadnja = true) {
  if (!x) return null;
  let v = x.total_value?.value;
  if (v === undefined && Array.isArray(x.values) && x.values.length) v = x.values[zadnja ? x.values.length - 1 : 0].value;
  if (v && typeof v === 'object') v = Object.values(v).reduce((s, n) => s + (+n || 0), 0);
  return broj(v);
}
const poImenu = (odg) => Object.fromEntries((odg?.data || []).map((x) => [x.name, x]));

class GreskaMete extends Error {}

function klijent(env, fetchFn) {
  const osnova = `${(env.META_URL || OSNOVA).replace(/\/$/, '')}/${env.META_VERZIJA || VERZIJA}`;
  let zahtjeva = 0;
  /** Vraća JSON; meke greške (npr. metrika koja ne postoji za tu objavu) kao { meka: poruka }; tvrde baca. */
  // `token`: zamjena za META_TOKEN (stranični token za rubove Facebook stranice). Nikad se ne sprema ni vraća.
  const get = async (put, upit = {}, token = null) => {
    if (zahtjeva >= NAJVISE_ZAHTJEVA) return null;
    zahtjeva++;
    const qs = new URLSearchParams(Object.entries(upit).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString();
    const odg = await fetchFn(`${osnova}/${put}${qs ? `?${qs}` : ''}`, {
      headers: { authorization: `Bearer ${String(token || env.META_TOKEN).trim()}`, accept: 'application/json' },
    });
    let d = null; try { d = await odg.json(); } catch {}
    if (odg.ok && d && !d.error) return d;
    const e = d?.error || {}, kod = +e.code;
    // Isti kod 190 Meta šalje i kad treba stranični token; to nije istekao token.
    if (kod === 190 && /page access token/i.test(e.message || '')) return { meka: 'Meta traži stranični token za ovaj podatak.' };
    if (kod === 190 || odg.status === 401) throw new GreskaMete(`Meta ne prihvaća token (istekao ili opozvan)${e.message ? `: ${String(e.message).slice(0, 120)}` : ''}. Napravi novi i upiši ga: npx wrangler secret put META_TOKEN`);
    if (kod === 10 || (kod >= 200 && kod < 300) || odg.status === 403) throw new GreskaMete('Tokenu nedostaje dozvola za čitanje uvida (instagram_basic, instagram_manage_insights, pages_read_engagement, read_insights).');
    if ([4, 17, 32, 613].includes(kod) || odg.status === 429) throw new GreskaMete('Meta je privremeno ograničila broj zahtjeva. Nastavlja se u idućem krugu.');
    if (kod === 803 || (kod === 100 && /node|exist|unknown path/i.test(e.message || '') && put === String(env.META_STRANICA).trim()))
      throw new GreskaMete('Meta ne nalazi tu Facebook stranicu. Provjeri META_STRANICA (id stranice).');
    if (odg.status >= 500) throw new GreskaMete(`Meta je vratila grešku ${odg.status}. Pokušat će ponovno u idućem krugu.`);
    return { meka: String(e.message || `greška ${odg.status}`).slice(0, 200) };
  };
  return { get, iskoristeno: () => zahtjeva, ima: (n = 1) => zahtjeva + n <= NAJVISE_ZAHTJEVA };
}

/** Jedan krug: stranica i Instagram račun, zbrojevi za 28 dana, nove objave i uvidi objava. */
export async function sinkronizirajMetu(env, tenant, { fetchFn = fetch, sada = () => new Date() } = {}) {
  if (!metaPodesena(env, tenant)) return { ok: false, greska: 'Meta nije spojena za ovog zakupca.' };
  const db = env.DB, k = klijent(env, fetchFn), stranica = String(env.META_STRANICA).trim();
  const sad = sada(), sadIso = sad.toISOString(), danas = datumZg(sad);
  const upozorenja = [];
  const upozori = (gdje, odg) => { if (odg?.meka) upozorenja.push(`${gdje}: ${odg.meka}`); };
  let greska = null, ig = null, igIme = null, stranicaIme = null, objava = 0, uvida = 0;

  const pratitelji = (kanal, n) => n == null ? null : db.prepare(`INSERT INTO meta_pratitelji (tenant_id, kanal, datum, pratitelji) VALUES (?, ?, ?, ?)
    ON CONFLICT (tenant_id, kanal, datum) DO UPDATE SET pratitelji = excluded.pratitelji`).bind(tenant, kanal, danas, n);
  const razdoblje = (kanal, oznaka, od, doD, v) => db.prepare(`INSERT INTO meta_razdoblje (tenant_id, kanal, oznaka, od, do, doseg, pregledi, interakcije, spremanja, dijeljenja, azurirano)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, kanal, oznaka) DO UPDATE SET od = excluded.od, do = excluded.do, doseg = excluded.doseg,
    pregledi = excluded.pregledi, interakcije = excluded.interakcije, spremanja = excluded.spremanja, dijeljenja = excluded.dijeljenja, azurirano = excluded.azurirano`)
    .bind(tenant, kanal, oznaka, od, doD, v.doseg ?? null, v.pregledi ?? null, v.interakcije ?? null, v.spremanja ?? null, v.dijeljenja ?? null, sadIso);
  const objavaRed = (kanal, o) => db.prepare(`INSERT INTO meta_objave (tenant_id, kanal, id, vrsta, objavljeno, poveznica, opis, lajkovi, komentari)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, kanal, id) DO UPDATE SET vrsta = excluded.vrsta, poveznica = excluded.poveznica, opis = excluded.opis,
    lajkovi = COALESCE(excluded.lajkovi, meta_objave.lajkovi), komentari = COALESCE(excluded.komentari, meta_objave.komentari)`)
    .bind(tenant, kanal, o.id, o.vrsta, o.objavljeno, o.poveznica, o.opis, o.lajkovi ?? null, o.komentari ?? null);
  const uvidiRed = (kanal, id, v) => db.prepare(`UPDATE meta_objave SET pregledi = COALESCE(?, pregledi), doseg = COALESCE(?, doseg), spremanja = COALESCE(?, spremanja),
    dijeljenja = COALESCE(?, dijeljenja), klikovi = COALESCE(?, klikovi), lajkovi = COALESCE(?, lajkovi), uvidi_azurirani = ? WHERE tenant_id = ? AND kanal = ? AND id = ?`)
    .bind(v.pregledi ?? null, v.doseg ?? null, v.spremanja ?? null, v.dijeljenja ?? null, v.klikovi ?? null, v.lajkovi ?? null, sadIso, tenant, kanal, id);
  const izvrsi = async (naredbe) => { const n = naredbe.filter(Boolean); if (n.length) await db.batch(n); };

  // Unix sekunde za 28 + 28 dana (Meta: since/until)
  const s = (ms) => Math.floor(ms / 1000);
  const kraj = sad.getTime(), r1 = { od: kraj - 28 * DAN, do: kraj }, r0 = { od: kraj - 56 * DAN, do: kraj - 28 * DAN };
  const d = (ms) => datumZg(new Date(ms));

  try {
    // 1) stranica + povezani Instagram poslovni račun
    const str = await k.get(stranica, { fields: 'name,followers_count,fan_count,access_token,instagram_business_account{id,username,followers_count}' });
    if (str?.meka) throw new GreskaMete(`Meta ne daje podatke stranice: ${str.meka}`);
    stranicaIme = str.name || null;
    // Pregled i objave Facebook stranice traže stranični token, koji se dobiva od stranice (token korisnika sustava ga ne zamjenjuje).
    const stranicniToken = str.access_token || null;
    if (!stranicniToken) upozorenja.push('Facebook: Meta nije dala stranični token. Provjeri da korisnik sustava ima stranicu s pravom na uvide.');
    ig = str.instagram_business_account?.id || null;
    igIme = str.instagram_business_account?.username || null;
    if (!ig) upozorenja.push('Facebook stranica nema povezan Instagram poslovni ili kreatorski račun.');
    await izvrsi([pratitelji('facebook', broj(str.followers_count ?? str.fan_count)), ig && pratitelji('instagram', broj(str.instagram_business_account.followers_count))]);

    // 2) Instagram: zbrojevi za zadnjih i prethodnih 28 dana
    if (ig) {
      for (const [oznaka, r] of [['zadnjih', r1], ['prethodnih', r0]]) {
        let odg = await k.get(`${ig}/insights`, { metric: 'reach,views,total_interactions,saves,shares', period: 'day', metric_type: 'total_value', since: s(r.od), until: s(r.do) });
        if (odg?.meka) { upozori(`Instagram (${oznaka} 28 dana)`, odg); odg = await k.get(`${ig}/insights`, { metric: 'reach', period: 'day', metric_type: 'total_value', since: s(r.od), until: s(r.do) }); }
        if (!odg || odg.meka) continue;
        const m = poImenu(odg);
        await izvrsi([razdoblje('instagram', oznaka, d(r.od), d(r.do), {
          doseg: vrijednost(m.reach), pregledi: vrijednost(m.views), interakcije: vrijednost(m.total_interactions), spremanja: vrijednost(m.saves), dijeljenja: vrijednost(m.shares),
        })]);
      }
      // 3) Instagram objave
      const med = await k.get(`${ig}/media`, { fields: 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count', limit: 30 });
      upozori('Instagram objave', med);
      if (med && !med.meka) {
        await izvrsi((med.data || []).filter((m) => m.id && m.timestamp).map((m) => objavaRed('instagram', {
          id: String(m.id), vrsta: vrstaIg(m), objavljeno: new Date(m.timestamp).toISOString(), poveznica: m.permalink || null,
          opis: cistiOpis(m.caption), lajkovi: broj(m.like_count), komentari: broj(m.comments_count),
        })));
        objava += (med.data || []).length;
      }
    }

    // 4) i 5) Facebook stranica (stranični token). Greška ovdje je upozorenje: Instagram i uvidi objava ipak nastavljaju.
    try {
      if (stranicniToken) {
        // pregledi i jedinstveni gledatelji (28 dana, klizno)
        const fbt = await k.get(`${stranica}/insights`, { metric: 'page_media_view,page_total_media_view_unique', period: 'days_28', since: s(kraj - 30 * DAN), until: s(kraj) }, stranicniToken);
        upozori('Facebook stranica', fbt);
        if (fbt && !fbt.meka) {
          const m = poImenu(fbt);
          const prvi = (x) => { const v = x?.values || []; return v.length >= 2 ? vrijednost(x, false) : null; };
          await izvrsi([
            razdoblje('facebook', 'zadnjih', d(r1.od), d(r1.do), { pregledi: vrijednost(m.page_media_view), doseg: vrijednost(m.page_total_media_view_unique) }),
            razdoblje('facebook', 'prethodnih', d(r0.od), d(r0.do), { pregledi: prvi(m.page_media_view), doseg: prvi(m.page_total_media_view_unique) }),
          ]);
        }
        const fbo = await k.get(`${stranica}/posts`, { fields: 'id,message,created_time,permalink_url,status_type', limit: 20 }, stranicniToken);
        upozori('Facebook objave', fbo);
        if (fbo && !fbo.meka) {
          await izvrsi((fbo.data || []).filter((p) => p.id && p.created_time).map((p) => objavaRed('facebook', {
            id: String(p.id), vrsta: vrstaFb(p), objavljeno: new Date(p.created_time).toISOString(), poveznica: p.permalink_url || null, opis: cistiOpis(p.message),
          })));
          objava += (fbo.data || []).length;
        }
      }
    } catch (e) {
      if (!(e instanceof GreskaMete)) throw e;
      upozorenja.push(`Facebook: ${e.message}`.slice(0, 220));
    }

    // 6) uvidi objava: prvo nikad osvježene, pa najstarije osvježene, samo mlađe od 35 dana (osim prvog puta)
    const granica = new Date(kraj - SVJEZE_DANA * DAN).toISOString(), staro = new Date(kraj - OSVJEZI_UVIDE_MS).toISOString();
    const red = (await db.prepare(`SELECT kanal, id FROM meta_objave WHERE tenant_id = ?
        AND (uvidi_azurirani IS NULL OR (objavljeno >= ? AND uvidi_azurirani < ?))
        ORDER BY uvidi_azurirani IS NOT NULL, uvidi_azurirani, objavljeno DESC LIMIT 60`).bind(tenant, granica, staro).all()).results;
    for (const o of red) {
      if (!k.ima()) break;
      let v = null;
      if (o.kanal === 'instagram') {
        let odg = await k.get(`${o.id}/insights`, { metric: 'views,reach,saved,shares,total_interactions' });
        if (odg?.meka && k.ima()) odg = await k.get(`${o.id}/insights`, { metric: 'reach,saved' });
        if (!odg) break;
        const m = poImenu(odg.meka ? {} : odg);
        v = { pregledi: vrijednost(m.views), doseg: vrijednost(m.reach), spremanja: vrijednost(m.saved), dijeljenja: vrijednost(m.shares) };
      } else {
        if (!stranicniToken) continue;
        const odg = await k.get(`${o.id}/insights`, { metric: 'post_media_view,post_total_media_view_unique,post_reactions_by_type_total,post_clicks' }, stranicniToken);
        if (!odg) break;
        const m = poImenu(odg.meka ? {} : odg);
        v = { pregledi: vrijednost(m.post_media_view), doseg: vrijednost(m.post_total_media_view_unique), lajkovi: vrijednost(m.post_reactions_by_type_total), klikovi: vrijednost(m.post_clicks) };
      }
      await izvrsi([uvidiRed(o.kanal, o.id, v)]);
      uvida++;
    }
  } catch (e) {
    if (!(e instanceof GreskaMete)) console.error('meta', e);
    greska = e instanceof GreskaMete ? e.message : 'Veza s Metom nije uspjela. Pokušat će ponovno u idućem krugu.';
  }

  await db.prepare(`INSERT INTO meta_sinkronizacija (tenant_id, ig_korisnik, ig_ime, stranica_ime, zadnje, zadnje_uspjesno, greska, upozorenja_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id) DO UPDATE SET ig_korisnik = COALESCE(excluded.ig_korisnik, meta_sinkronizacija.ig_korisnik),
      ig_ime = COALESCE(excluded.ig_ime, meta_sinkronizacija.ig_ime), stranica_ime = COALESCE(excluded.stranica_ime, meta_sinkronizacija.stranica_ime),
      zadnje = excluded.zadnje, zadnje_uspjesno = COALESCE(excluded.zadnje_uspjesno, meta_sinkronizacija.zadnje_uspjesno),
      greska = excluded.greska, upozorenja_json = excluded.upozorenja_json`)
    .bind(tenant, ig, igIme, stranicaIme, sadIso, greska ? null : sadIso, greska, JSON.stringify(upozorenja.slice(0, 8))).run();
  return { ok: !greska, greska, objava, uvida, upozorenja, zahtjeva: k.iskoristeno() };
}

// ---------- izračun za ekran (bez mreže, testira se zasebno) ----------
const zgDijelovi = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', weekday: 'short', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { dan: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday), sat: +p.hour };
};
const najbliziSat = (h) => SATI.reduce((b, s, i) => (Math.abs(s - h) < Math.abs(SATI[b] - h) ? i : b), 0);
const tisuce = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const prosjek = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
const posto = (novo, staro) => (novo != null && staro ? Math.round((novo - staro) / staro * 100) : null);
const NAZIV_VRSTE = { reel: 'Reelsi', video: 'Videi', slika: 'Fotografije', album: 'Albumi', objava: 'Tekstualne objave' };
const OD_VRSTE = { reel: 'reelsa', video: 'videa', slika: 'fotografija', album: 'albuma', objava: 'tekstualnih objava' };
const DANI_KADA = ['ponedjeljkom', 'utorkom', 'srijedom', 'četvrtkom', 'petkom', 'subotom', 'nedjeljom'];
/** 1 objava, 2 objave, 5 objava (hrvatska množina). */
export const brojObjava = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'objava' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'objave' : 'objava'}`;

/** Brojke jednog kanala za ekran Mreže. objave: redovi iz baze; pratitelji: [{datum, pratitelji}] uzlazno. */
export function izracunajKanal({ objave = [], pratitelji = [], razdoblja = {}, danas }) {
  const sObjave = [...objave].sort((a, b) => a.objavljeno.localeCompare(b.objavljeno));
  const sPregledima = sObjave.filter((o) => o.pregledi != null);
  const zadnjih10 = sPregledima.slice(-10);
  const zad5 = zadnjih10.slice(-5), pret5 = zadnjih10.slice(-10, -5);
  const pz = prosjek(zad5.map((o) => o.pregledi)), pp = pret5.length ? prosjek(pret5.map((o) => o.pregledi)) : null;

  // pratitelji danas i prije ~30 dana (ili najstariji zapis)
  const zadnji = pratitelji[pratitelji.length - 1] || null;
  const prije30 = danas ? new Date(Date.parse(danas) - 30 * DAN).toISOString().slice(0, 10) : null;
  const usporedni = pratitelji.find((p) => p.datum >= prije30) || null;
  const rast = zadnji && usporedni && usporedni.datum < zadnji.datum ? zadnji.pratitelji - usporedni.pratitelji : null;

  // kad objaviti: prosjek pregleda po danu i satu (zadnjih 180 dana)
  const od180 = danas ? new Date(Date.parse(danas) - 180 * DAN).toISOString() : '';
  const celije = DANI.map(() => SATI.map(() => []));
  for (const o of sPregledima) {
    if (o.objavljeno < od180) continue;
    const z = zgDijelovi(o.objavljeno);
    if (z.dan >= 0) celije[z.dan][najbliziSat(z.sat)].push(o.pregledi);
  }
  const toplina = celije.map((r) => r.map((c) => ({ prosjek: prosjek(c), objava: c.length })));
  let najbolje = null;
  toplina.forEach((r, i) => r.forEach((c, j) => { if (c.objava >= 2 && (!najbolje || c.prosjek > najbolje.prosjek)) najbolje = { dan: i, sat: j, ...c }; }));

  // uvidi (izračun ploče, ne agent)
  const uvidi = [];
  const p = posto(pz, pp);
  if (p != null && zad5.length === 5 && pret5.length === 5)
    uvidi.push({ smjer: p > 5 ? 'gore' : p < -5 ? 'dolje' : 'ravno', tekst: `Zadnjih 5 objava ima prosječno ${Math.abs(p)} % ${p >= 0 ? 'više' : 'manje'} pregleda od prethodnih 5.` });
  const od90 = danas ? new Date(Date.parse(danas) - 90 * DAN).toISOString() : '';
  const poVrsti = {};
  for (const o of sPregledima.filter((x) => x.objavljeno >= od90)) (poVrsti[o.vrsta] ||= []).push(o.pregledi);
  const vrste = Object.entries(poVrsti).filter(([, a]) => a.length >= 2).map(([v, a]) => ({ v, p: prosjek(a) })).sort((a, b) => b.p - a.p);
  if (vrste.length >= 2 && vrste[1].p > 0) {
    const omjer = vrste[0].p / vrste[1].p;
    if (omjer >= 1.3) uvidi.push({ smjer: 'gore', tekst: `${NAZIV_VRSTE[vrste[0].v] || vrste[0].v} imaju prosječno ${omjer >= 2 ? `${String(Math.round(omjer * 10) / 10).replace('.', ',')} puta` : `${Math.round((omjer - 1) * 100)} %`} više pregleda od ${OD_VRSTE[vrste[1].v] || vrste[1].v} (zadnjih 90 dana).` });
  }
  if (najbolje) uvidi.push({ smjer: 'sat', tekst: `Najbolje prolaze objave ${DANI_KADA[najbolje.dan]} oko ${SATI[najbolje.sat]} h: prosječno ${tisuce(najbolje.prosjek)} pregleda (${brojObjava(najbolje.objava)}).` });
  const spremane = sObjave.filter((o) => o.spremanja > 0 && o.objavljeno >= od90).sort((a, b) => b.spremanja - a.spremanja)[0];
  if (spremane) uvidi.push({ smjer: 'gore', tekst: `Najviše spremanja u 90 dana (${spremane.spremanja}): ${spremane.opis ? `„${spremane.opis.slice(0, 60)}${spremane.opis.length > 60 ? '…' : ''}”` : 'objava bez opisa'}.` });

  const z = razdoblja.zadnjih || null, pr = razdoblja.prethodnih || null;
  const sp = zad5.filter((o) => o.spremanja != null);
  return {
    pratitelji: zadnji?.pratitelji ?? null, pratiteljiRast: rast, pratiteljiOd: usporedni && usporedni.datum < zadnji?.datum ? usporedni.datum : null,
    doseg28: z?.doseg ?? null, dosegPromjena: posto(z?.doseg, pr?.doseg),
    pregledi28: z?.pregledi ?? null, preglediPromjena: posto(z?.pregledi, pr?.pregledi),
    prosjekZadnjih5: pz, prosjekPrethodnih5: pp, promjena5: p,
    spremanjaPoObjavi: sp.length ? Math.round(sp.reduce((s2, o) => s2 + o.spremanja, 0) / sp.length * 10) / 10 : null,
    graf: zadnjih10.map((o) => ({ id: o.id, pregledi: o.pregledi, objavljeno: o.objavljeno, vrsta: o.vrsta, opis: o.opis, poveznica: o.poveznica })),
    toplina, najbolje, uvidi,
    objave: [...sObjave].reverse().slice(0, 12).map((o) => ({ id: o.id, vrsta: o.vrsta, objavljeno: o.objavljeno, opis: o.opis, poveznica: o.poveznica,
      pregledi: o.pregledi, doseg: o.doseg, lajkovi: o.lajkovi, komentari: o.komentari, spremanja: o.spremanja, dijeljenja: o.dijeljenja })),
    ukupnoObjava: sObjave.length,
  };
}

/** Sve za ekran Mreže. */
export async function pregledMreza(env, tenant, sada = new Date()) {
  const db = env.DB, danas = datumZg(sada);
  const [st, objave, prat, raz] = await Promise.all([
    db.prepare(`SELECT * FROM meta_sinkronizacija WHERE tenant_id = ?`).bind(tenant).first(),
    db.prepare(`SELECT * FROM meta_objave WHERE tenant_id = ? AND objavljeno >= ? ORDER BY objavljeno`).bind(tenant, new Date(sada.getTime() - 200 * DAN).toISOString()).all(),
    db.prepare(`SELECT kanal, datum, pratitelji FROM meta_pratitelji WHERE tenant_id = ? AND datum >= ? ORDER BY datum`).bind(tenant, new Date(sada.getTime() - 40 * DAN).toISOString().slice(0, 10)).all(),
    db.prepare(`SELECT * FROM meta_razdoblje WHERE tenant_id = ?`).bind(tenant).all(),
  ]);
  const kanal = (k) => izracunajKanal({
    objave: objave.results.filter((o) => o.kanal === k), pratitelji: prat.results.filter((p) => p.kanal === k),
    razdoblja: Object.fromEntries(raz.results.filter((r) => r.kanal === k).map((r) => [r.oznaka, r])), danas,
  });
  return {
    danas,
    meta: {
      spojeno: metaPodesena(env, tenant), zadnje: st?.zadnje ?? null, zadnjeUspjesno: st?.zadnje_uspjesno ?? null, greska: st?.greska ?? null,
      upozorenja: parse(st?.upozorenja_json) || [], igIme: st?.ig_ime ?? null, stranicaIme: st?.stranica_ime ?? null, igSpojen: !!st?.ig_korisnik,
    },
    sati: SATI, dani: DANI,
    kanali: { instagram: kanal('instagram'), facebook: kanal('facebook') },
  };
}
