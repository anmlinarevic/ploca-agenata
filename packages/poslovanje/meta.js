/* Instagram i Facebook stranice preko Meta Graph API-ja. Samo čitanje vlastitih računa: ploča ništa ne objavljuje
 * i ne čita poruke ni komentare. Token je tajna Workera (META_TOKEN, token korisnika sustava koji vrijedi za sve stranice koje mu
 * je dodijeljena imovina); ide u zaglavlje (ne u adresu), nikad u bazu ni pregledniku. Računi (stranice) su u tablici `racuni`;
 * tajna META_STRANICA se još čita samo za prijelaz sa stare postavke. Instagram poslovni račun pronalazi se preko stranice. */
import { osiguraStareRacune } from './racuni.js';

const OSNOVA = 'https://graph.facebook.com';
const VERZIJA = 'v25.0';
// Free plan Workersa dopušta 50 podzahtjeva po pozivu; ostatak uvida stiže u idućem krugu.
const NAJVISE_ZAHTJEVA = 40;
const DAN = 86400000;
const OSVJEZI_UVIDE_MS = 20 * 3600000;   // uvidi objave najviše jednom u 20 sati
const SVJEZE_DANA = 35;                   // nakon toga se brojke objave više ne osvježavaju

const PROZOR_DANA = 30;                   // Meta daje dnevne uvide u komadima do 30 dana
const POVIJEST_DANA = 365;                // koliko unazad ploča učitava dnevne brojke
const NAJVISE_PROZORA_POVIJESTI = 2;      // koliko starijih komada po krugu (ostalo stiže u idućim krugovima)
export const SATI = [8, 11, 14, 17, 20, 22];
export const DANI = ['ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota', 'nedjelja'];

/** Je li Meta podešena za ovog zakupca (postoji token). Koje su stranice dodane, vidi se u tablici `racuni`. */
export const metaPodesena = (env, tenant) => !!(env.META_TOKEN && (env.META_ZAKUPAC || 'piccolini') === tenant);

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

/** `fatalno`: problem je zajednički za sve stranice (token, dozvole, ograničenje brzine, Metina greška), pa se krug prekida. */
class GreskaMete extends Error { constructor(poruka, fatalno = false) { super(poruka); this.fatalno = fatalno; } }

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
    if (kod === 190 || odg.status === 401) throw new GreskaMete(`Meta ne prihvaća token (istekao ili opozvan)${e.message ? `: ${String(e.message).slice(0, 120).replace(/\.+$/, '')}` : ''}. Napravi novi i upiši ga: npx wrangler secret put META_TOKEN`, true);
    if (kod === 10 || (kod >= 200 && kod < 300) || odg.status === 403) throw new GreskaMete('Tokenu nedostaje dozvola za čitanje uvida (instagram_basic, instagram_manage_insights, pages_read_engagement, read_insights).', true);
    if ([4, 17, 32, 613].includes(kod) || odg.status === 429) throw new GreskaMete('Meta je privremeno ograničila broj zahtjeva. Nastavlja se u idućem krugu.', true);
    if (kod === 803 || (kod === 100 && /node|exist|unknown path/i.test(e.message || '') && /^\d+$/.test(put)))
      throw new GreskaMete('Meta ne nalazi tu Facebook stranicu. Provjeri ID stranice računa i je li stranica dodijeljena korisniku sustava.');
    if (odg.status >= 500) throw new GreskaMete(`Meta je vratila grešku ${odg.status}. Pokušat će ponovno u idućem krugu.`, true);
    return { meka: String(e.message || `greška ${odg.status}`).slice(0, 200) };
  };
  return { get, iskoristeno: () => zahtjeva, ima: (n = 1) => zahtjeva + n <= NAJVISE_ZAHTJEVA };
}

/** Jedan krug: svaka dodana Facebook stranica i njezin Instagram račun, zbrojevi za 28 dana, nove objave i uvidi objava.
 *  Stranice se obrađuju jedna po jedna, najprije one koje su najdulje čekale; greška jedne stranice ne zaustavlja ostale,
 *  osim problema zajedničkih svima (token, dozvole, ograničenje brzine). `racunId` ograničava krug na stranicu tog računa. */
export async function sinkronizirajMetu(env, tenant, { fetchFn = fetch, sada = () => new Date(), racunId = null } = {}) {
  if (!metaPodesena(env, tenant)) return { ok: false, greska: 'Meta nije spojena za ovog zakupca.' };
  const db = env.DB;
  await osiguraStareRacune(env, tenant);
  let racuni = (await db.prepare(`SELECT * FROM racuni WHERE tenant_id = ? AND aktivan = 1 AND mreza IN ('facebook', 'instagram') AND stranica_id IS NOT NULL
    ORDER BY COALESCE(zadnje, ''), kreirano, id`).bind(tenant).all()).results;
  if (racunId) {
    const r = racuni.find((x) => x.id === racunId);
    if (!r) return { ok: false, greska: 'Račun nije pronađen ili nije Facebook ni Instagram račun.' };
    racuni = racuni.filter((x) => x.stranica_id === r.stranica_id);
  }
  if (!racuni.length) return { ok: false, greska: 'Nema dodanih Facebook ni Instagram računa. Dodaj račun na stranici Mreže.' };
  const stranice = [...new Set(racuni.map((r) => r.stranica_id))];
  const k = klijent(env, fetchFn), sad = sada();
  const zbroj = { objava: 0, uvida: 0, upozorenja: [], greske: [] };
  for (const [i, stranica] of stranice.entries()) {
    if (!k.ima(3)) { zbroj.upozorenja.push(`${stranice.length - i} stranica čeka idući krug (ograničenje broja zahtjeva po pozivu).`); break; }
    const r = await sinkronizirajStranicu(env, tenant, stranica, racuni.filter((x) => x.stranica_id === stranica), k, sad);
    zbroj.objava += r.objava; zbroj.uvida += r.uvida;
    zbroj.upozorenja.push(...r.upozorenja);
    if (r.greska) zbroj.greske.push(r.greska);
    if (r.fatalno) break;
  }
  return { ok: !zbroj.greske.length, greska: zbroj.greske[0] || null, objava: zbroj.objava, uvida: zbroj.uvida, upozorenja: zbroj.upozorenja, zahtjeva: k.iskoristeno() };
}

/** Jedna Facebook stranica s povezanim Instagramom. Ne baca: greška se zapisuje na račune stranice i vraća. */
async function sinkronizirajStranicu(env, tenant, stranica, racuniStranice, k, sad) {
  const db = env.DB, sadIso = sad.toISOString(), danas = datumZg(sad);
  const fbRacun = racuniStranice.find((r) => r.mreza === 'facebook') || null;
  let igRacun = racuniStranice.find((r) => r.mreza === 'instagram') || null;
  const upozorenja = [];
  const upozori = (gdje, odg) => { if (odg?.meka) upozorenja.push(`${gdje}: ${odg.meka}`); };
  let greska = null, fatalno = false, ig = null, igIme = null, stranicaIme = null, objava = 0, uvida = 0;

  const pratitelji = (racun, n) => (racun == null || n == null) ? null : db.prepare(`INSERT INTO brojke_dan (tenant_id, racun_id, datum, mjera, vrijednost) VALUES (?, ?, ?, 'pratitelji', ?)
    ON CONFLICT (tenant_id, racun_id, datum, mjera) DO UPDATE SET vrijednost = excluded.vrijednost`).bind(tenant, racun, danas, n);
  const razdoblje = (racun, kanal, oznaka, od, doD, v) => racun == null ? null : db.prepare(`INSERT INTO meta_razdoblje (tenant_id, racun_id, kanal, oznaka, od, do, doseg, pregledi, interakcije, spremanja, dijeljenja, azurirano)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, racun_id, oznaka) DO UPDATE SET od = excluded.od, do = excluded.do, doseg = excluded.doseg,
    pregledi = excluded.pregledi, interakcije = excluded.interakcije, spremanja = excluded.spremanja, dijeljenja = excluded.dijeljenja, azurirano = excluded.azurirano`)
    .bind(tenant, racun, kanal, oznaka, od, doD, v.doseg ?? null, v.pregledi ?? null, v.interakcije ?? null, v.spremanja ?? null, v.dijeljenja ?? null, sadIso);
  const objavaRed = (racun, kanal, o) => db.prepare(`INSERT INTO meta_objave (tenant_id, racun_id, kanal, id, vrsta, objavljeno, poveznica, opis, lajkovi, komentari)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, racun_id, id) DO UPDATE SET vrsta = excluded.vrsta, poveznica = excluded.poveznica, opis = excluded.opis,
    lajkovi = COALESCE(excluded.lajkovi, meta_objave.lajkovi), komentari = COALESCE(excluded.komentari, meta_objave.komentari)`)
    .bind(tenant, racun, kanal, o.id, o.vrsta, o.objavljeno, o.poveznica, o.opis, o.lajkovi ?? null, o.komentari ?? null);
  const uvidiRed = (racun, id, v) => db.prepare(`UPDATE meta_objave SET pregledi = COALESCE(?, pregledi), doseg = COALESCE(?, doseg), spremanja = COALESCE(?, spremanja),
    dijeljenja = COALESCE(?, dijeljenja), klikovi = COALESCE(?, klikovi), lajkovi = COALESCE(?, lajkovi), uvidi_azurirani = ? WHERE tenant_id = ? AND racun_id = ? AND id = ?`)
    .bind(v.pregledi ?? null, v.doseg ?? null, v.spremanja ?? null, v.dijeljenja ?? null, v.klikovi ?? null, v.lajkovi ?? null, sadIso, tenant, racun, id);
  const izvrsi = async (naredbe) => { const n = naredbe.filter(Boolean); for (let i = 0; i < n.length; i += 90) await db.batch(n.slice(i, i + 90)); };

  // Unix sekunde za 28 + 28 dana (Meta: since/until)
  const s = (ms) => Math.floor(ms / 1000);
  const kraj = sad.getTime(), r1 = { od: kraj - 28 * DAN, do: kraj }, r0 = { od: kraj - 56 * DAN, do: kraj - 28 * DAN };
  const d = (ms) => datumZg(new Date(ms));

  try {
    // 1) stranica + povezani Instagram poslovni račun
    const str = await k.get(stranica, { fields: 'name,followers_count,fan_count,access_token,instagram_business_account{id,username,followers_count}' });
    if (str?.meka) throw new GreskaMete(`Meta ne daje podatke stranice: ${str.meka}`);
    if (!str) throw new GreskaMete('Ograničenje broja zahtjeva: stranica čeka idući krug.', true);
    stranicaIme = str.name || null;
    // Pregled i objave Facebook stranice traže stranični token, koji se dobiva od stranice (token korisnika sustava ga ne zamjenjuje).
    const stranicniToken = str.access_token || null;
    if (fbRacun && !stranicniToken) upozorenja.push('Facebook: Meta nije dala stranični token. Provjeri da korisnik sustava ima stranicu s pravom na uvide.');
    ig = str.instagram_business_account?.id || null;
    igIme = str.instagram_business_account?.username || null;
    if (!ig && igRacun) upozorenja.push('Facebook stranica nema povezan Instagram poslovni ili kreatorski račun.');
    // Stranica ima Instagram, a na ploči nije dodan nijedan Instagram račun za nju (ni uklonjen): dodaje se sam.
    if (ig && !igRacun) {
      const bilo = await db.prepare(`SELECT id FROM racuni WHERE tenant_id = ? AND mreza = 'instagram' AND stranica_id = ?`).bind(tenant, stranica).first();
      if (!bilo) {
        const id = `instagram-${crypto.randomUUID().slice(0, 8)}`;
        await db.prepare(`INSERT INTO racuni (id, tenant_id, mreza, naziv, naziv_rucno, usluga, vanjski_id, stranica_id, status, kreirano) VALUES (?, ?, 'instagram', ?, 0, ?, ?, ?, 'ceka', ?)`)
          .bind(id, tenant, igIme ? `@${igIme}` : 'Instagram račun', fbRacun?.usluga || 'oboje', ig, stranica, sadIso).run();
        igRacun = { id, mreza: 'instagram', naziv_rucno: 0, usluga: fbRacun?.usluga || 'oboje' };
      }
    }
    await izvrsi([fbRacun && pratitelji(fbRacun.id, broj(str.followers_count ?? str.fan_count)), ig && igRacun && pratitelji(igRacun.id, broj(str.instagram_business_account.followers_count))]);

    // 2) Instagram: zbrojevi za zadnjih i prethodnih 28 dana
    if (ig && igRacun) {
      for (const [oznaka, r] of [['zadnjih', r1], ['prethodnih', r0]]) {
        let odg = await k.get(`${ig}/insights`, { metric: 'reach,views,total_interactions,saves,shares', period: 'day', metric_type: 'total_value', since: s(r.od), until: s(r.do) });
        if (odg?.meka) { upozori(`Instagram (${oznaka} 28 dana)`, odg); odg = await k.get(`${ig}/insights`, { metric: 'reach', period: 'day', metric_type: 'total_value', since: s(r.od), until: s(r.do) }); }
        if (!odg || odg.meka) continue;
        const m = poImenu(odg);
        await izvrsi([razdoblje(igRacun.id, 'instagram', oznaka, d(r.od), d(r.do), {
          doseg: vrijednost(m.reach), pregledi: vrijednost(m.views), interakcije: vrijednost(m.total_interactions), spremanja: vrijednost(m.saves), dijeljenja: vrijednost(m.shares),
        })]);
      }
      // 3) Instagram objave
      const med = await k.get(`${ig}/media`, { fields: 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count', limit: 30 });
      upozori('Instagram objave', med);
      if (med && !med.meka) {
        await izvrsi((med.data || []).filter((m) => m.id && m.timestamp).map((m) => objavaRed(igRacun.id, 'instagram', {
          id: String(m.id), vrsta: vrstaIg(m), objavljeno: new Date(m.timestamp).toISOString(), poveznica: m.permalink || null,
          opis: cistiOpis(m.caption), lajkovi: broj(m.like_count), komentari: broj(m.comments_count),
        })));
        objava += (med.data || []).length;
      }
    }

    // 4) i 5) Facebook stranica (stranični token). Greška ovdje je upozorenje: Instagram i uvidi objava ipak nastavljaju.
    try {
      if (stranicniToken && fbRacun) {
        // pregledi i jedinstveni gledatelji (28 dana, klizno)
        const fbt = await k.get(`${stranica}/insights`, { metric: 'page_media_view,page_total_media_view_unique', period: 'days_28', since: s(kraj - 30 * DAN), until: s(kraj) }, stranicniToken);
        upozori('Facebook stranica', fbt);
        if (fbt && !fbt.meka) {
          const m = poImenu(fbt);
          const prvi = (x) => { const v = x?.values || []; return v.length >= 2 ? vrijednost(x, false) : null; };
          await izvrsi([
            razdoblje(fbRacun.id, 'facebook', 'zadnjih', d(r1.od), d(r1.do), { pregledi: vrijednost(m.page_media_view), doseg: vrijednost(m.page_total_media_view_unique) }),
            razdoblje(fbRacun.id, 'facebook', 'prethodnih', d(r0.od), d(r0.do), { pregledi: prvi(m.page_media_view), doseg: prvi(m.page_total_media_view_unique) }),
          ]);
        }
        const fbo = await k.get(`${stranica}/posts`, { fields: 'id,message,created_time,permalink_url,status_type', limit: 20 }, stranicniToken);
        upozori('Facebook objave', fbo);
        if (fbo && !fbo.meka) {
          await izvrsi((fbo.data || []).filter((p) => p.id && p.created_time).map((p) => objavaRed(fbRacun.id, 'facebook', {
            id: String(p.id), vrsta: vrstaFb(p), objavljeno: new Date(p.created_time).toISOString(), poveznica: p.permalink_url || null, opis: cistiOpis(p.message),
          })));
          objava += (fbo.data || []).length;
        }
      }
    } catch (e) {
      if (!(e instanceof GreskaMete) || e.fatalno) throw e;
      upozorenja.push(`Facebook: ${e.message}`.slice(0, 220));
    }

    // 5b) dnevni pregledi i doseg: zadnjih 30 dana svaki krug (ispravlja kasne Metine korekcije), a povijest do godine dana po jedan do dva komada.
    //     Meta ne daje svaku metriku kao dnevni niz za svaku vrstu računa: ako ne da, račun to bilježi (dnevno_greska) i ekran to kaže.
    const dnevni = [
      ig && igRacun ? { racun: igRacun, kanal: 'instagram', put: `${ig}/insights`, token: null, metrike: [['reach', 'doseg'], ['views', 'pregledi']] } : null,
      fbRacun && stranicniToken ? { racun: fbRacun, kanal: 'facebook', put: `${stranica}/insights`, token: stranicniToken, metrike: [['page_total_media_view_unique', 'doseg'], ['page_media_view', 'pregledi']] } : null,
    ].filter(Boolean);
    for (const dr of dnevni) await povuciDnevno({ db, k, tenant, dr, danas, kraj, upozorenja, izvrsi });

    // 6) uvidi objava ove stranice: prvo nikad osvježene, pa najstarije osvježene, samo mlađe od 35 dana (osim prvog puta)
    const idovi = [fbRacun?.id, igRacun?.id].filter(Boolean);
    const granica = new Date(kraj - SVJEZE_DANA * DAN).toISOString(), staro = new Date(kraj - OSVJEZI_UVIDE_MS).toISOString();
    const red = idovi.length ? (await db.prepare(`SELECT racun_id, kanal, id FROM meta_objave WHERE tenant_id = ? AND racun_id IN (${idovi.map(() => '?').join(',')})
        AND (uvidi_azurirani IS NULL OR (objavljeno >= ? AND uvidi_azurirani < ?))
        ORDER BY uvidi_azurirani IS NOT NULL, uvidi_azurirani, objavljeno DESC LIMIT 60`).bind(tenant, ...idovi, granica, staro).all()).results : [];
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
      await izvrsi([uvidiRed(o.racun_id, o.id, v)]);
      uvida++;
    }
  } catch (e) {
    if (!(e instanceof GreskaMete)) console.error('meta', e);
    greska = e instanceof GreskaMete ? e.message : 'Veza s Metom nije uspjela. Pokušat će ponovno u idućem krugu.';
    fatalno = !(e instanceof GreskaMete) || e.fatalno;
  }

  // Stanje svakog računa stranice. Naziv postavlja Meta samo ako ga nije upisao čovjek.
  const stanje = (r, naziv, vanjski) => db.prepare(`UPDATE racuni SET zadnje = ?, zadnje_uspjesno = CASE WHEN ? IS NULL THEN ? ELSE zadnje_uspjesno END, greska = ?,
      status = ?, upozorenja_json = ?, vanjski_id = COALESCE(?, vanjski_id), naziv = CASE WHEN naziv_rucno = 0 AND ? IS NOT NULL THEN ? ELSE naziv END,
      povijest_od = COALESCE(povijest_od, (SELECT MIN(datum) FROM brojke_dan b WHERE b.tenant_id = racuni.tenant_id AND b.racun_id = racuni.id))
    WHERE tenant_id = ? AND id = ?`).bind(sadIso, greska, sadIso, greska, greska ? 'greska' : 'spojeno', JSON.stringify(upozorenja.slice(0, 8)), vanjski, naziv, naziv, tenant, r.id);
  await db.batch([
    fbRacun && stanje(fbRacun, stranicaIme, stranica),
    igRacun && stanje(igRacun, igIme ? `@${igIme}` : null, ig),
  ].filter(Boolean));
  return { objava, uvida, upozorenja, greska, fatalno };
}

/** Dan na koji se odnosi Metin dnevni uvid: end_time je kraj dana (sljedeće jutro po UTC-u), pa je dan 24 sata prije. */
export const danIzKrajaDana = (endTime) => datumZg(new Date(Date.parse(endTime) - 24 * 3600000));

/** Dnevni pregledi i doseg jednog računa: najnoviji prozor od 30 dana + do dva starija prozora povijesti. */
async function povuciDnevno({ db, k, tenant, dr, danas, kraj, upozorenja, izvrsi }) {
  const dodaj = (iso, d) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const s = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
  const cilj = dodaj(danas, -POVIJEST_DANA);
  const zadnjiDan = dodaj(danas, -1);                 // današnji dan nije gotov
  const prozori = [{ od: dodaj(zadnjiDan, -(PROZOR_DANA - 1)), do: zadnjiDan }];
  let kursor = dr.racun.povijest_dnevno_od || null;
  if (kursor == null) kursor = prozori[0].od;       // prvi krug: najnoviji prozor je ujedno početak povijesti
  for (let i = 0; i < NAJVISE_PROZORA_POVIJESTI && kursor > cilj; i++) {
    if (!k.ima(2 * dr.metrike.length + 8)) break;     // ostavi zahtjeve za objave i uvide
    const doD = dodaj(kursor, -1), od = dodaj(doD, -(PROZOR_DANA - 1));
    prozori.push({ od: od < cilj ? cilj : od, do: doD });
    kursor = od < cilj ? cilj : od;
  }
  let greska = null, najranije = null;
  for (const [i, w] of prozori.entries()) {
    const redovi = [];
    for (const [metrika, mjera] of dr.metrike) {
      const odg = await k.get(dr.put, { metric: metrika, period: 'day', since: s(w.od), until: s(w.do) + 86400 }, dr.token);
      if (odg == null) return stanjeDnevno(); // ponestalo zahtjeva: ono što je učitano ostaje, ostalo stiže u idućem krugu
      if (odg.meka) { greska = `${metrika}: ${odg.meka}`; continue; }   // ostale metrike ipak ostaju
      const niz = (odg.data || []).find((x) => x.name === metrika)?.values || [];
      for (const v of niz) {
        const dan = v.end_time ? danIzKrajaDana(v.end_time) : null;
        if (dan && dan >= w.od && dan <= w.do && Number.isFinite(+v.value)) redovi.push([dan, mjera, Math.round(+v.value)]);
      }
    }
    await izvrsi(redovi.map(([dan, mjera, v]) => db.prepare(`INSERT INTO brojke_dan (tenant_id, racun_id, datum, mjera, vrijednost) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, racun_id, datum, mjera) DO UPDATE SET vrijednost = excluded.vrijednost`).bind(tenant, dr.racun.id, dan, mjera, v)));
    if (najranije == null || w.od < najranije) najranije = w.od;
    if (greska) break;     // Meta ne daje metriku: starije prozore ne tražimo uzalud
  }
  return stanjeDnevno();

  async function stanjeDnevno() {
    if (greska) {
      upozorenja.push(`Dnevne brojke (${dr.kanal}): Meta ih ne daje za ovaj račun (${greska}). Za razdoblja dulja od 28 dana nema podataka.`.slice(0, 220));
      await db.prepare(`UPDATE racuni SET dnevno_greska = ? WHERE tenant_id = ? AND id = ?`).bind(greska.slice(0, 200), tenant, dr.racun.id).run();
      return;
    }
    if (najranije == null) return;
    await db.prepare(`UPDATE racuni SET dnevno_greska = NULL, povijest_dnevno_od = CASE WHEN povijest_dnevno_od IS NULL OR ? < povijest_dnevno_od THEN ? ELSE povijest_dnevno_od END
      WHERE tenant_id = ? AND id = ?`).bind(najranije, najranije, tenant, dr.racun.id).run();
  }
}

// ---------- izračun za ekran (bez mreže, testira se zasebno) ----------
const zgDijelovi = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', weekday: 'short', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { dan: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday), sat: +p.hour };
};
const najbliziSat = (h) => SATI.reduce((b, s, i) => (Math.abs(s - h) < Math.abs(SATI[b] - h) ? i : b), 0);
const tisuce = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const medijan = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const prosjek = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
const posto = (novo, staro) => (novo != null && staro ? Math.round((novo - staro) / staro * 100) : null);
const NAZIV_VRSTE = { reel: 'Reelsi', video: 'Videi', slika: 'Fotografije', album: 'Albumi', objava: 'Tekstualne objave' };
const OD_VRSTE = { reel: 'reelsa', video: 'videa', slika: 'fotografija', album: 'albuma', objava: 'tekstualnih objava' };
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
  const poSatu = SATI.map(() => []), poDanu = DANI.map(() => []);
  let uzorak = 0, jedna = null;
  for (const o of sPregledima) {
    if (o.objavljeno < od180) continue;
    const z = zgDijelovi(o.objavljeno);
    if (z.dan < 0) continue;
    const j = najbliziSat(z.sat);
    celije[z.dan][j].push(o.pregledi); poSatu[j].push(o.pregledi); poDanu[z.dan].push(o.pregledi); uzorak++;
    if (!jedna || o.pregledi > jedna.pregledi) jedna = { dan: z.dan, sat: j, pregledi: o.pregledi };
  }
  const toplina = celije.map((r) => r.map((c) => ({ prosjek: prosjek(c), objava: c.length })));
  let najbolje = null;
  toplina.forEach((r, i) => r.forEach((c, j) => { if (c.objava >= 2 && (!najbolje || c.prosjek > najbolje.prosjek)) najbolje = { dan: i, sat: j, ...c }; }));
  // Zaključak gleda cijele sate i cijele dane (više objava u skupini) i medijan, da jedna viralna objava ne odluči.
  const najGrupa = (g) => { let b = null; g.forEach((a, i) => { if (a.length >= 3) { const m = medijan(a); if (!b || m > b.medijan) b = { indeks: i, medijan: m, objava: a.length }; } }); return b; };
  const kadObjaviti = { uzorak, sat: najGrupa(poSatu), dan: najGrupa(poDanu), jedna };

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
  if (kadObjaviti.sat) uvidi.push({ smjer: 'sat', tekst: `Objave oko ${SATI[kadObjaviti.sat.indeks]} h imaju najviše pregleda (medijan ${tisuce(kadObjaviti.sat.medijan)}, ${brojObjava(kadObjaviti.sat.objava)}).` });
  if (kadObjaviti.dan) uvidi.push({ smjer: 'sat', tekst: `Najbolji dan je ${DANI[kadObjaviti.dan.indeks]} (medijan ${tisuce(kadObjaviti.dan.medijan)} pregleda, ${brojObjava(kadObjaviti.dan.objava)}).` });
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
    toplina, najbolje, kadObjaviti, uvidi,
    objave: [...sObjave].reverse().slice(0, 12).map((o) => ({ id: o.id, vrsta: o.vrsta, objavljeno: o.objavljeno, opis: o.opis, poveznica: o.poveznica,
      pregledi: o.pregledi, doseg: o.doseg, lajkovi: o.lajkovi, komentari: o.komentari, spremanja: o.spremanja, dijeljenja: o.dijeljenja })),
    ukupnoObjava: sObjave.length,
  };
}

/** Razdoblje za Mreže: `dana=N` (1 do 366, do jučer) ili `od` i `do` (YYYY-MM-DD, najkasnije jučer). Baca Error za neispravan unos. */
export function razdobljeMreza(upit = {}, danas) {
  const DATUM = /^\d{4}-\d{2}-\d{2}$/;
  const dod = (iso, k) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const razl = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAN);
  const jucer = dod(danas, -1);
  if (upit.od || upit.do) {
    const od = String(upit.od || ''), doD = String(upit.do || jucer);
    if (!DATUM.test(od) || !DATUM.test(doD)) throw new Error('Razdoblje: od i do kao YYYY-MM-DD');
    if (od > doD) throw new Error('Početak razdoblja mora biti prije kraja');
    if (doD > jucer) throw new Error('Razdoblje može završiti najkasnije jučer');
    const dana = razl(od, doD) + 1;
    if (dana > 366) throw new Error('Razdoblje: najviše 366 dana');
    return { od, do: doD, dana, dod };
  }
  const dana = upit.dana == null ? 28 : Number(upit.dana);
  if (!Number.isInteger(dana) || dana < 1 || dana > 366) throw new Error('Razdoblje: 1 do 366 dana');
  return { od: dod(jucer, -(dana - 1)), do: jucer, dana, dod };
}

/**
 * Dnevne brojke računa za razdoblje (pregledi i doseg), usporedba s prethodnim istim po duljini i objave u razdoblju.
 * Doseg je po danu: za razdoblje se zbraja, pa nije broj jedinstvenih osoba. Usporedba samo kad je prethodno razdoblje cijelo učitano.
 */
async function brojkeRazdoblja(db, tenant, racuni, r, objave) {
  const prOd = r.dod(r.od, -r.dana), prDo = r.dod(r.od, -1);
  const redovi = (await db.prepare(`SELECT racun_id, datum, mjera, vrijednost FROM brojke_dan WHERE tenant_id = ? AND mjera IN ('pregledi', 'doseg') AND datum >= ? AND datum <= ? ORDER BY datum`)
    .bind(tenant, prOd, r.do).all()).results;
  return Object.fromEntries(racuni.map((rac) => {
    const moji = redovi.filter((x) => x.racun_id === rac.id);
    const zbroj = (mjera, od, doD) => { const l = moji.filter((x) => x.mjera === mjera && x.datum >= od && x.datum <= doD); return { v: l.reduce((a, x) => a + x.vrijednost, 0), n: l.length }; };
    const mjera = (m) => {
      const ovo = zbroj(m, r.od, r.do), prije = zbroj(m, prOd, prDo);
      const imaPrije = prije.n === r.dana;
      return { vrijednost: ovo.n ? ovo.v : null, dana: ovo.n, prethodno: imaPrije ? prije.v : null, promjena: imaPrije && ovo.n === r.dana ? posto(ovo.v, prije.v) : null };
    };
    const serija = new Map();
    for (const x of moji) if (x.datum >= r.od && x.datum <= r.do) { const z = serija.get(x.datum) || { datum: x.datum }; z[x.mjera] = x.vrijednost; serija.set(x.datum, z); }
    const odlomak = (objave || []).filter((o) => o.racun_id === rac.id && o.objavljeno.slice(0, 10) >= r.od && o.objavljeno.slice(0, 10) <= r.do);
    return [rac.id, {
      pregledi: mjera('pregledi'), doseg: mjera('doseg'), serija: [...serija.values()].sort((a, b) => (a.datum < b.datum ? -1 : 1)),
      pokriveno: mjera('pregledi').dana, objaveBroj: odlomak.length,
      objave: odlomak.sort((a, b) => (a.objavljeno < b.objavljeno ? 1 : -1)).slice(0, 100).map((o) => ({ id: o.id, vrsta: o.vrsta, objavljeno: o.objavljeno, opis: o.opis, poveznica: o.poveznica, pregledi: o.pregledi, doseg: o.doseg, spremanja: o.spremanja })),
    }];
  }));
}

/** Sve za ekran Mreže: popis računa s brojkama svakog, a `kanali` i `meta` ostaju (prvi račun po mreži) da stari ekran radi dok se ne prebaci. */
export async function pregledMreza(env, tenant, sada = new Date(), upit = null) {
  const db = env.DB, danas = datumZg(sada);
  const [racuni, objave, prat, raz] = await Promise.all([
    db.prepare(`SELECT * FROM racuni WHERE tenant_id = ? AND aktivan = 1 AND mreza IN ('facebook', 'instagram') ORDER BY mreza, kreirano, id`).bind(tenant).all(),
    db.prepare(`SELECT * FROM meta_objave WHERE tenant_id = ? AND objavljeno >= ? ORDER BY objavljeno`).bind(tenant, new Date(sada.getTime() - 200 * DAN).toISOString()).all(),
    db.prepare(`SELECT racun_id, datum, vrijednost AS pratitelji FROM brojke_dan WHERE tenant_id = ? AND mjera = 'pratitelji' AND datum >= ? ORDER BY datum`).bind(tenant, new Date(sada.getTime() - 40 * DAN).toISOString().slice(0, 10)).all(),
    db.prepare(`SELECT * FROM meta_razdoblje WHERE tenant_id = ?`).bind(tenant).all(),
  ]);
  const podaci = (r) => izracunajKanal({
    objave: objave.results.filter((o) => o.racun_id === r.id), pratitelji: prat.results.filter((p) => p.racun_id === r.id),
    razdoblja: Object.fromEntries(raz.results.filter((x) => x.racun_id === r.id).map((x) => [x.oznaka, x])), danas,
  });
  const lista = racuni.results.map((r) => ({
    id: r.id, mreza: r.mreza, naziv: r.naziv, usluga: r.usluga, status: r.status, zadnje: r.zadnje, zadnjeUspjesno: r.zadnje_uspjesno,
    greska: r.greska, upozorenja: parse(r.upozorenja_json) || [], povijestOd: r.povijest_od, podaci: podaci(r),
  }));
  const razdoblje = upit && (upit.dana != null || upit.od || upit.do) ? razdobljeMreza(upit, danas) : null;
  if (razdoblje) {
    const sve = (await db.prepare(`SELECT * FROM meta_objave WHERE tenant_id = ? AND objavljeno >= ? ORDER BY objavljeno`).bind(tenant, `${razdoblje.dod(razdoblje.od, -1)}T00:00:00Z`).all()).results;
    const b = await brojkeRazdoblja(db, tenant, racuni.results, razdoblje, sve);
    const prviPost = (await db.prepare(`SELECT MIN(objavljeno) AS prvi FROM meta_objave WHERE tenant_id = ?`).bind(tenant).first())?.prvi ?? null;
    for (const r of lista) {
      const rr = racuni.results.find((x) => x.id === r.id);
      r.razdoblje = { ...b[r.id], dnevnoGreska: rr?.dnevno_greska ?? null, povijestDnevnoOd: rr?.povijest_dnevno_od ?? null, objaveDostupnoOd: prviPost ? prviPost.slice(0, 10) : null };
    }
  }
  const prvi = (m) => lista.find((r) => r.mreza === m) || null;
  const fb = prvi('facebook'), ig = prvi('instagram');
  const najnovije = (k) => lista.map((r) => r[k]).filter(Boolean).sort().pop() ?? null;
  const prazno = () => izracunajKanal({ danas });
  return {
    danas,
    meta: {
      spojeno: metaPodesena(env, tenant), zadnje: najnovije('zadnje'), zadnjeUspjesno: najnovije('zadnjeUspjesno'), greska: lista.find((r) => r.greska)?.greska ?? null,
      upozorenja: lista.flatMap((r) => r.upozorenja).slice(0, 8), igIme: ig ? ig.naziv.replace(/^@/, '') : null, stranicaIme: fb?.naziv ?? null,
      igSpojen: !!racuni.results.find((r) => r.mreza === 'instagram' && r.vanjski_id),
    },
    sati: SATI, dani: DANI,
    razdoblje: razdoblje ? { od: razdoblje.od, do: razdoblje.do, dana: razdoblje.dana } : null,
    racuni: lista,
    kanali: { instagram: ig ? ig.podaci : prazno(), facebook: fb ? fb.podaci : prazno() },
  };
}
