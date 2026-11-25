/* Google Search Console preko servisnog računa (Search Analytics, Sitemaps, URL Inspection). Samo čitanje:
 * opseg webmasters.readonly, a račun u Search Consoleu ima ulogu „Ograničeno”. Ploča ne šalje sitemape ni zahtjeve za indeksiranje.
 * Ključ servisnog računa (JSON) i svojstvo su tajne Workera (GSC_KLJUC, GSC_SVOJSTVO). Ključ potpisuje kratki JWT u Workeru;
 * ni ključ ni pristupni token nikad ne idu u bazu ni pregledniku. E-mail servisnog računa nije tajna i prikazuje se radi uputa. */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://searchconsole.googleapis.com';
const OPSEG = 'https://www.googleapis.com/auth/webmasters.readonly';
// Free plan Workersa dopušta 50 podzahtjeva po pozivu; ostatak provjera stiže sutra.
const NAJVISE_ZAHTJEVA = 40;
const DAN = 86400000;
const KASNI_DANA = 3;                       // Search Console ima konačne brojke s 2–3 dana zakašnjenja
const NAJVISE_ADRESA = 20;                  // koliko adresa iz sitemapa se provjerava u indeksu
export const OSVJEZI_MS = 20 * 3600000;     // cijela sinkronizacija i provjera adrese najviše jednom u 20 sati

/** Je li Search Console podešen za ovog zakupca. */
export const gscPodesen = (env, tenant) =>
  !!(env.GSC_KLJUC && env.GSC_SVOJSTVO && (env.GSC_ZAKUPAC || 'piccolini') === tenant);

/** Je li na redu dnevna sinkronizacija (cron je zove umjesto jednog kruga Parre, da ne dijele ograničenje podzahtjeva). */
export async function gscNaRedu(env, tenant, sada = new Date()) {
  if (!gscPodesen(env, tenant)) return false;
  const r = await env.DB.prepare(`SELECT zadnje FROM gsc_sinkronizacija WHERE tenant_id = ?`).bind(tenant).first();
  return !r?.zadnje || Date.parse(r.zadnje) <= sada.getTime() - OSVJEZI_MS;
}

const datumZg = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb' }).format(new Date(ms));
const parse = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };
const broj = (v) => (v == null || v === '' || Number.isNaN(+v) ? null : Math.round(+v));
const dec = (v, n) => (v == null || v === '' || Number.isNaN(+v) ? null : Math.round(+v * 10 ** n) / 10 ** n);

/** Upit za ploču: bez e-mailova i brojeva telefona, skraćen. */
export const cistiUpit = (s) => String(s || '')
  .replace(/\S+@\S+\.\S+/g, '…').replace(/\+?\d[\d\s/-]{7,}\d/g, '…')
  .replace(/\s+/g, ' ').trim().slice(0, 120) || null;

class GreskaGsc extends Error {}

const b64u = (bajtovi) => {
  let s = '';
  for (const b of bajtovi) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const tekstB64u = (t) => b64u(new TextEncoder().encode(t));

function procitajKljuc(env) {
  let k;
  try { k = JSON.parse(String(env.GSC_KLJUC).trim()); } catch {
    throw new GreskaGsc('GSC_KLJUC nije ispravan JSON. Upiši cijelu datoteku ključa servisnog računa (.json), vidi docs/GSC-SPAJANJE.md.');
  }
  if (!k?.client_email || !k?.private_key) throw new GreskaGsc('U GSC_KLJUC nedostaje client_email ili private_key. Upiši cijelu datoteku ključa servisnog računa.');
  return k;
}

/** OAuth 2.0 za servisni račun: JWT potpisan ključem (RS256) → pristupni token na sat vremena. */
async function pristupniToken(kljuc, tokenUrl, fetchFn, sadMs) {
  let kripto;
  try {
    const pem = String(kljuc.private_key).replace(/-----[A-Z ]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
    kripto = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new GreskaGsc('Privatni ključ u GSC_KLJUC nije ispravan. Napravi novi ključ servisnog računa (JSON) i upiši ga ponovno.');
  }
  const iat = Math.floor(sadMs / 1000) - 30;
  const ulaz = `${tekstB64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${tekstB64u(JSON.stringify({
    iss: kljuc.client_email, scope: OPSEG, aud: tokenUrl, iat, exp: iat + 3600,
  }))}`;
  const potpis = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kripto, new TextEncoder().encode(ulaz)));
  const odg = await fetchFn(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${ulaz}.${b64u(potpis)}` }).toString(),
  });
  let d = null; try { d = await odg.json(); } catch {}
  if (odg.ok && d?.access_token) return d.access_token;
  if (odg.status >= 500) throw new GreskaGsc(`Google je vratio grešku ${odg.status} pri prijavi. Pokušat će ponovno sutra.`);
  const zasto = String(d?.error_description || d?.error || `greška ${odg.status}`).slice(0, 100);
  throw new GreskaGsc(`Google ne prihvaća ključ servisnog računa (${zasto}). Ključ je možda obrisan: napravi novi i upiši GSC_KLJUC.`);
}

function klijent(env, fetchFn, token, kljuc, svojstvo) {
  const osnova = (env.GSC_API_URL || API).replace(/\/$/, '');
  let zahtjeva = 1; // prijava
  const zovi = async (metoda, put, tijelo = null, { meko = false } = {}) => {
    if (zahtjeva >= NAJVISE_ZAHTJEVA) return null;
    zahtjeva++;
    const odg = await fetchFn(`${osnova}${put}`, {
      method: metoda,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(tijelo ? { 'content-type': 'application/json' } : {}) },
      body: tijelo ? JSON.stringify(tijelo) : undefined,
    });
    let d = null; try { d = await odg.json(); } catch {}
    if (odg.ok) return d || {};
    const poruka = String(d?.error?.message || `greška ${odg.status}`).replace(/\s+/g, ' ').slice(0, 200);
    if (meko && odg.status !== 401 && odg.status !== 429 && odg.status < 500) return { meka: poruka };
    if (odg.status === 403 && /has not been used|is disabled|SERVICE_DISABLED|not been enabled/i.test(poruka))
      throw new GreskaGsc('U Google Cloud projektu servisnog računa nije uključen „Google Search Console API”. Uključi ga (APIs & Services → Library), pa osvježi.');
    if (odg.status === 403)
      throw new GreskaGsc(`Servisni račun nema pristup svojstvu ${svojstvo}. U Search Consoleu: Postavke → Korisnici i dopuštenja → Dodaj korisnika ${kljuc.client_email} s dopuštenjem „Ograničeno”.`);
    if (odg.status === 404)
      throw new GreskaGsc(`Search Console ne nalazi svojstvo ${svojstvo}. GSC_SVOJSTVO mora biti točno kao u Search Consoleu: sc-domain:piccoliniplay.hr (domena) ili https://www.piccoliniplay.hr/ (prefiks).`);
    if (odg.status === 401) throw new GreskaGsc('Google je odbio pristupni token. Pokušat će ponovno sutra; ako se ponavlja, napravi novi ključ.');
    if (odg.status === 429) throw new GreskaGsc('Google je privremeno ograničio broj zahtjeva. Nastavlja se sutra.');
    if (odg.status >= 500) throw new GreskaGsc(`Search Console je vratio grešku ${odg.status}. Pokušat će ponovno sutra.`);
    throw new GreskaGsc(`Search Console: ${poruka}`);
  };
  return { zovi, iskoristeno: () => zahtjeva, potrosi: () => { zahtjeva++; }, ima: (n = 1) => zahtjeva + n <= NAJVISE_ZAHTJEVA };
}

/** Adrese stranica iz sitemapa (samo http i https, bez podsitemapa). */
async function adreseIzSitemapa(putanja, fetchFn, k) {
  if (!/^https?:\/\//i.test(putanja) || !k.ima()) return { adrese: [] };
  k.potrosi();
  try {
    const odg = await fetchFn(putanja, { headers: { accept: 'application/xml, text/xml' } });
    if (!odg.ok) return { adrese: [], upozorenje: `Sitemap ${putanja} vraća ${odg.status}.` };
    const xml = await odg.text();
    const adrese = [...new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&')))]
      .filter((u) => /^https?:\/\//i.test(u) && !/\.xml(\?|$)/i.test(u)).slice(0, NAJVISE_ADRESA);
    return { adrese };
  } catch {
    return { adrese: [], upozorenje: `Sitemap ${putanja} se ne može pročitati.` };
  }
}

const zbroj = (x) => ({
  klikovi: broj(x?.clicks) ?? 0, pojavljivanja: broj(x?.impressions) ?? 0,
  ctr: x?.impressions ? dec(x.ctr, 4) : null, pozicija: x?.impressions ? dec(x.position, 1) : null,
});

/** Jedan krug: zbrojevi za 28 + 28 dana, dani, upiti, stranice, zemlje, sitemapi i indeksiranje adresa iz sitemapa. */
export async function sinkronizirajGsc(env, tenant, { fetchFn = fetch, sada = () => new Date() } = {}) {
  if (!gscPodesen(env, tenant)) return { ok: false, greska: 'Search Console nije spojen za ovog zakupca.' };
  const db = env.DB, svojstvo = String(env.GSC_SVOJSTVO).trim();
  const sad = sada(), sadIso = sad.toISOString(), sadMs = sad.getTime();
  const upozorenja = [];
  let greska = null, racun = null, dozvola = null, doDatuma = null, stavki = 0, provjereno = 0, k = null;
  const izvrsi = async (naredbe) => { const n = naredbe.filter(Boolean); if (n.length) await db.batch(n); };
  const site = `/webmasters/v3/sites/${encodeURIComponent(svojstvo)}`;

  try {
    const kljuc = procitajKljuc(env);
    racun = kljuc.client_email;
    const token = await pristupniToken(kljuc, env.GSC_TOKEN_URL || TOKEN_URL, fetchFn, sadMs);
    k = klijent(env, fetchFn, token, kljuc, svojstvo);

    // 1) svojstvo i dozvola servisnog računa
    const s = await k.zovi('GET', site);
    dozvola = s?.permissionLevel || null;
    if (dozvola === 'siteUnverifiedUser') throw new GreskaGsc(`Svojstvo ${svojstvo} još nije potvrđeno u Search Consoleu (TXT zapis u DNS-u). Potvrdi ga, pa osvježi.`);

    // 2) razdoblja: zadnjih 28 dana do prije 3 dana, i 28 dana prije toga
    const kraj = sadMs - KASNI_DANA * DAN;
    doDatuma = datumZg(kraj);
    const r1 = { od: datumZg(kraj - 27 * DAN), do: doDatuma }, r0 = { od: datumZg(kraj - 55 * DAN), do: datumZg(kraj - 28 * DAN) };
    const upit = (r, dims, rowLimit) => k.zovi('POST', `${site}/searchAnalytics/query`, { startDate: r.od, endDate: r.do, dimensions: dims, rowLimit, type: 'web' });
    for (const [oznaka, r] of [['zadnjih', r1], ['prethodnih', r0]]) {
      const o = await upit(r, [], 1);
      const z = zbroj(o?.rows?.[0]);
      await izvrsi([db.prepare(`INSERT INTO gsc_razdoblje (tenant_id, oznaka, od, do, klikovi, pojavljivanja, ctr, pozicija, azurirano) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, oznaka) DO UPDATE SET od = excluded.od, do = excluded.do, klikovi = excluded.klikovi, pojavljivanja = excluded.pojavljivanja,
        ctr = excluded.ctr, pozicija = excluded.pozicija, azurirano = excluded.azurirano`)
        .bind(tenant, oznaka, r.od, r.do, z.klikovi, z.pojavljivanja, z.ctr, z.pozicija, sadIso)]);
    }

    // 3) po danu, od prvog dana mjeseca prije dva mjeseca; cijeli mjeseci idu i u mjesečne brojke ploče
    const [g, m] = doDatuma.split('-').map(Number);
    const odMj = new Date(Date.UTC(g, m - 3, 1)).toISOString().slice(0, 10);
    const dani = await upit({ od: odMj, do: doDatuma }, ['date'], 200);
    const redovi = (dani?.rows || []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.keys?.[0] || ''));
    const poMjesecu = {};
    for (const x of redovi) {
      const mj = x.keys[0].slice(0, 7);
      if (mj >= doDatuma.slice(0, 7)) continue; // tekući mjesec još nije gotov
      const t = (poMjesecu[mj] ||= { klikovi: 0, pojavljivanja: 0 });
      t.klikovi += broj(x.clicks) || 0; t.pojavljivanja += broj(x.impressions) || 0;
    }
    await izvrsi([
      ...redovi.map((x) => { const z = zbroj(x); return db.prepare(`INSERT INTO gsc_dani (tenant_id, datum, klikovi, pojavljivanja, ctr, pozicija) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, datum) DO UPDATE SET klikovi = excluded.klikovi, pojavljivanja = excluded.pojavljivanja, ctr = excluded.ctr, pozicija = excluded.pozicija`)
        .bind(tenant, x.keys[0], z.klikovi, z.pojavljivanja, z.ctr, z.pozicija); }),
      ...Object.entries(poMjesecu).map(([mj, t]) => db.prepare(`INSERT INTO mjesecno (tenant_id, mjesec, gsc_klikovi, gsc_pojavljivanja) VALUES (?, ?, ?, ?)
        ON CONFLICT (tenant_id, mjesec) DO UPDATE SET gsc_klikovi = excluded.gsc_klikovi, gsc_pojavljivanja = excluded.gsc_pojavljivanja`).bind(tenant, mj, t.klikovi, t.pojavljivanja)),
      db.prepare(`DELETE FROM gsc_dani WHERE tenant_id = ? AND datum < ?`).bind(tenant, datumZg(kraj - 120 * DAN)),
    ]);

    // 4) najbolji upiti, stranice i zemlje (zadnjih 28 dana) s brojkama prethodnih 28 dana
    const kljucStavke = (vrsta, v) => (vrsta === 'upit' ? cistiUpit(v) : vrsta === 'zemlja' ? String(v || '').toLowerCase().slice(0, 3) || null : String(v || '').slice(0, 300) || null);
    for (const [vrsta, dim, n] of [['upit', 'query', 25], ['stranica', 'page', 25], ['zemlja', 'country', 10]]) {
      const ovo = await upit(r1, [dim], n);
      if (!ovo) { upozorenja.push('Ponestalo je zahtjeva u ovom krugu; ostatak stiže sutra.'); break; }
      const prije = await upit(r0, [dim], 250);
      const mapaPrije = new Map((prije?.rows || []).map((x) => [kljucStavke(vrsta, x.keys?.[0]), zbroj(x)]));
      const nove = [];
      for (const x of ovo.rows || []) {
        const kl = kljucStavke(vrsta, x.keys?.[0]);
        if (!kl) continue;
        const a = zbroj(x), b = mapaPrije.get(kl);
        nove.push(db.prepare(`INSERT INTO gsc_stavke (tenant_id, vrsta, kljuc, klikovi, pojavljivanja, ctr, pozicija, klikovi_prije, pojavljivanja_prije, pozicija_prije)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, vrsta, kljuc) DO NOTHING`)
          .bind(tenant, vrsta, kl, a.klikovi, a.pojavljivanja, a.ctr, a.pozicija, b?.klikovi ?? null, b?.pojavljivanja ?? null, b?.pozicija ?? null));
      }
      await izvrsi([db.prepare(`DELETE FROM gsc_stavke WHERE tenant_id = ? AND vrsta = ?`).bind(tenant, vrsta), ...nove]);
      stavki += nove.length;
    }

    // 5) sitemapi
    let adrese = [];
    const sm = await k.zovi('GET', `${site}/sitemaps`, null, { meko: true });
    if (sm?.meka) upozorenja.push(`Sitemapi: ${sm.meka}`);
    else if (sm) {
      const lista = (sm.sitemap || []).filter((x) => x.path);
      if (!lista.length) upozorenja.push('U Search Console nije poslan nijedan sitemap. Pošalji https://www.piccoliniplay.hr/sitemap.xml (Indeksiranje → Sitemapi).');
      await izvrsi([
        db.prepare(`DELETE FROM gsc_sitemapi WHERE tenant_id = ?`).bind(tenant),
        ...lista.slice(0, 20).map((x) => db.prepare(`INSERT INTO gsc_sitemapi (tenant_id, putanja, poslano, zadnje_preuzeto, ceka, greske, upozorenja, adresa)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, putanja) DO NOTHING`)
          .bind(tenant, String(x.path).slice(0, 300), x.lastSubmitted || null, x.lastDownloaded || null, x.isPending ? 1 : 0, broj(x.errors) ?? 0, broj(x.warnings) ?? 0,
            (x.contents || []).reduce((s2, c) => s2 + (broj(c.submitted) || 0), 0))),
      ]);
      const prvi = lista.find((x) => !x.isSitemapsIndex) || lista[0];
      if (prvi) {
        const r = await adreseIzSitemapa(String(prvi.path), fetchFn, k);
        adrese = r.adrese;
        if (r.upozorenje) upozorenja.push(r.upozorenje);
      }
    }

    // 6) je li svaka stranica iz sitemapa u indeksu (jednom u 20 sati po adresi, prvo nikad provjerene)
    if (adrese.length) {
      await izvrsi([db.prepare(`DELETE FROM gsc_url WHERE tenant_id = ? AND url NOT IN (${adrese.map(() => '?').join(', ')})`).bind(tenant, ...adrese)]);
      const stari = new Map((await db.prepare(`SELECT url, provjereno FROM gsc_url WHERE tenant_id = ?`).bind(tenant).all()).results.map((r) => [r.url, r.provjereno]));
      const granica = new Date(sadMs - OSVJEZI_MS).toISOString();
      const naRedu = adrese.filter((u) => !stari.get(u) || stari.get(u) <= granica)
        .sort((a, b) => String(stari.get(a) || '').localeCompare(String(stari.get(b) || '')));
      let mekih = 0;
      for (const url of naRedu) {
        if (!k.ima()) break;
        const o = await k.zovi('POST', '/v1/urlInspection/index:inspect', { inspectionUrl: url, siteUrl: svojstvo, languageCode: 'hr' }, { meko: true });
        if (!o) break;
        if (o.meka) { if (mekih++ < 2) upozorenja.push(`Provjera ${url}: ${o.meka}`); continue; }
        const ir = o.inspectionResult?.indexStatusResult || {};
        await izvrsi([db.prepare(`INSERT INTO gsc_url (tenant_id, url, presuda, pokrivenost, zadnje_puzanje, dohvat, robots, kanonski_google, kanonski_nas, provjereno)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, url) DO UPDATE SET presuda = excluded.presuda, pokrivenost = excluded.pokrivenost,
          zadnje_puzanje = excluded.zadnje_puzanje, dohvat = excluded.dohvat, robots = excluded.robots, kanonski_google = excluded.kanonski_google,
          kanonski_nas = excluded.kanonski_nas, provjereno = excluded.provjereno`)
          .bind(tenant, url, ir.verdict || null, ir.coverageState ? String(ir.coverageState).slice(0, 120) : null, ir.lastCrawlTime || null,
            ir.pageFetchState || null, ir.robotsTxtState || null, ir.googleCanonical || null, ir.userCanonical || null, sadIso)]);
        provjereno++;
      }
    }
  } catch (e) {
    if (!(e instanceof GreskaGsc)) console.error('gsc', e);
    greska = e instanceof GreskaGsc ? e.message : 'Veza sa Search Consoleom nije uspjela. Pokušat će ponovno sutra.';
  }

  await db.prepare(`INSERT INTO gsc_sinkronizacija (tenant_id, svojstvo, racun, dozvola, do_datuma, zadnje, zadnje_uspjesno, greska, upozorenja_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id) DO UPDATE SET svojstvo = excluded.svojstvo, racun = COALESCE(excluded.racun, gsc_sinkronizacija.racun),
      dozvola = COALESCE(excluded.dozvola, gsc_sinkronizacija.dozvola), do_datuma = CASE WHEN excluded.greska IS NULL THEN excluded.do_datuma ELSE gsc_sinkronizacija.do_datuma END,
      zadnje = excluded.zadnje, zadnje_uspjesno = COALESCE(excluded.zadnje_uspjesno, gsc_sinkronizacija.zadnje_uspjesno),
      greska = excluded.greska, upozorenja_json = excluded.upozorenja_json`)
    .bind(tenant, svojstvo, racun, dozvola, doDatuma, sadIso, greska ? null : sadIso, greska, JSON.stringify(upozorenja.slice(0, 8))).run();
  return { ok: !greska, greska, stavki, provjereno, upozorenja, zahtjeva: k ? k.iskoristeno() : 0 };
}

// ---------- izračun za ekran (bez mreže) ----------
const tisuce = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const zarez = (x) => String(x).replace('.', ',');
const posto = (novo, staro) => (novo != null && staro ? Math.round((novo - staro) / staro * 100) : null);
export const ZEMLJE = { hrv: 'Hrvatska', svn: 'Slovenija', bih: 'Bosna i Hercegovina', srb: 'Srbija', mne: 'Crna Gora', deu: 'Njemačka', aut: 'Austrija', ita: 'Italija', che: 'Švicarska', usa: 'SAD', gbr: 'Ujedinjeno Kraljevstvo', irl: 'Irska', hun: 'Mađarska' };
const KLIK = (n) => `${tisuce(n)} ${n % 10 === 1 && n % 100 !== 11 ? 'klik' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'klika' : 'klikova'}`;

/** Brojke i zaključci za ekran Web iz redova baze. */
export function izracunajWeb({ razdoblja = {}, dani = [], stavke = [], sitemapi = [], adrese = [] }) {
  const z = razdoblja.zadnjih || null, p = razdoblja.prethodnih || null;
  const stavka = (x) => ({
    kljuc: x.kljuc, klikovi: x.klikovi, pojavljivanja: x.pojavljivanja, ctr: x.ctr, pozicija: x.pozicija,
    klikoviPrije: x.klikovi_prije, pozicijaPrije: x.pozicija_prije,
    pomak: x.pozicija != null && x.pozicija_prije != null ? Math.round((x.pozicija_prije - x.pozicija) * 10) / 10 : null,
  });
  const redaj = (a, b) => b.klikovi - a.klikovi || b.pojavljivanja - a.pojavljivanja;
  const upiti = stavke.filter((x) => x.vrsta === 'upit').map(stavka).sort(redaj);
  const stranice = stavke.filter((x) => x.vrsta === 'stranica').map(stavka).sort(redaj);
  const zemlje = stavke.filter((x) => x.vrsta === 'zemlja').map((x) => ({ ...stavka(x), naziv: ZEMLJE[x.kljuc] || x.kljuc.toUpperCase() })).sort(redaj);
  const indeks = adrese.map((a) => ({
    url: a.url, presuda: a.presuda, pokrivenost: a.pokrivenost, zadnjePuzanje: a.zadnje_puzanje, provjereno: a.provjereno,
    uIndeksu: a.presuda === 'PASS', drugiKanonski: !!(a.kanonski_google && a.kanonski_nas && a.kanonski_google !== a.kanonski_nas),
  })).sort((a, b) => Number(a.uIndeksu) - Number(b.uIndeksu) || a.url.localeCompare(b.url));

  const uvidi = [];
  const pk = posto(z?.klikovi, p?.klikovi);
  if (z) uvidi.push({ smjer: pk == null ? 'ravno' : pk > 5 ? 'gore' : pk < -5 ? 'dolje' : 'ravno',
    tekst: `Google je u 28 dana donio ${KLIK(z.klikovi)}${pk == null ? '' : ` (${pk >= 0 ? '+' : '−'}${Math.abs(pk)} % naspram prethodnih 28 dana)`}, uz ${tisuce(z.pojavljivanja)} pojavljivanja u rezultatima.` });
  const nisu = indeks.filter((a) => a.presuda && !a.uIndeksu);
  if (nisu.length) uvidi.push({ smjer: 'dolje', tekst: `${nisu.length} od ${indeks.length} stranica iz sitemapa nije u Googleovom indeksu: ${nisu.slice(0, 3).map((a) => a.url.replace(/^https?:\/\/[^/]+/, '') || '/').join(', ')}${nisu.length > 3 ? '…' : ''}.` });
  const prag = upiti.filter((x) => x.pozicija > 10 && x.pozicija <= 20 && x.pojavljivanja >= 10).sort((a, b) => b.pojavljivanja - a.pojavljivanja)[0];
  if (prag) uvidi.push({ smjer: 'gore', tekst: `„${prag.kljuc}” je na ${zarez(prag.pozicija)}. mjestu (druga stranica) s ${tisuce(prag.pojavljivanja)} pojavljivanja. Pomak na prvu stranicu donosi klikove.` });
  const ctr = upiti.filter((x) => x.pozicija != null && x.pozicija <= 5 && x.pojavljivanja >= 30 && x.ctr != null && x.ctr < 0.02).sort((a, b) => b.pojavljivanja - a.pojavljivanja)[0];
  if (ctr) uvidi.push({ smjer: 'ravno', tekst: `„${ctr.kljuc}”: ${tisuce(ctr.pojavljivanja)} pojavljivanja na ${zarez(ctr.pozicija)}. mjestu, a klikne ${zarez(Math.round(ctr.ctr * 1000) / 10)} %. Naslov i opis stranice vjerojatno ne mame klik.` });
  const raste = upiti.filter((x) => x.pomak != null && x.pomak >= 3 && x.pojavljivanja >= 10).sort((a, b) => b.pomak - a.pomak)[0];
  if (raste) uvidi.push({ smjer: 'gore', tekst: `„${raste.kljuc}” se popeo za ${zarez(raste.pomak)} mjesta, sada je na ${zarez(raste.pozicija)}. mjestu.` });
  const si = zemlje.find((x) => x.kljuc === 'svn');
  if (si && z?.klikovi) uvidi.push({ smjer: 'ravno', tekst: `Iz Slovenije ${KLIK(si.klikovi)} (${Math.round(si.klikovi / z.klikovi * 100)} % svih) i ${tisuce(si.pojavljivanja)} pojavljivanja.` });
  const smGreske = sitemapi.filter((x) => x.greske > 0);
  if (smGreske.length) uvidi.push({ smjer: 'dolje', tekst: `Sitemap ${smGreske[0].putanja} ima ${smGreske[0].greske} grešaka u Search Consoleu.` });

  return {
    zadnjih: z && { od: z.od, do: z.do, klikovi: z.klikovi, pojavljivanja: z.pojavljivanja, ctr: z.ctr, pozicija: z.pozicija },
    prethodnih: p && { od: p.od, do: p.do, klikovi: p.klikovi, pojavljivanja: p.pojavljivanja, ctr: p.ctr, pozicija: p.pozicija },
    promjene: {
      klikovi: pk, pojavljivanja: posto(z?.pojavljivanja, p?.pojavljivanja),
      ctr: z?.ctr != null && p?.ctr != null ? Math.round((z.ctr - p.ctr) * 1000) / 10 : null,
      pozicija: z?.pozicija != null && p?.pozicija != null ? Math.round((p.pozicija - z.pozicija) * 10) / 10 : null, // + znači bolje (bliže vrhu)
    },
    dani: z ? dani.filter((d) => d.datum >= z.od && d.datum <= z.do).map((d) => ({ datum: d.datum, klikovi: d.klikovi, pojavljivanja: d.pojavljivanja })) : [],
    upiti, stranice, zemlje, indeks,
    sitemapi: sitemapi.map((x) => ({ putanja: x.putanja, poslano: x.poslano, zadnjePreuzeto: x.zadnje_preuzeto, ceka: !!x.ceka, greske: x.greske, upozorenja: x.upozorenja, adresa: x.adresa })),
    uvidi,
  };
}

/** Sve za ekran Web. */
export async function pregledWeba(env, tenant) {
  const db = env.DB;
  const [st, raz, dani, stavke, sm, adrese] = await Promise.all([
    db.prepare(`SELECT * FROM gsc_sinkronizacija WHERE tenant_id = ?`).bind(tenant).first(),
    db.prepare(`SELECT * FROM gsc_razdoblje WHERE tenant_id = ?`).bind(tenant).all(),
    db.prepare(`SELECT datum, klikovi, pojavljivanja FROM gsc_dani WHERE tenant_id = ? ORDER BY datum`).bind(tenant).all(),
    db.prepare(`SELECT * FROM gsc_stavke WHERE tenant_id = ?`).bind(tenant).all(),
    db.prepare(`SELECT * FROM gsc_sitemapi WHERE tenant_id = ? ORDER BY putanja`).bind(tenant).all(),
    db.prepare(`SELECT * FROM gsc_url WHERE tenant_id = ?`).bind(tenant).all(),
  ]);
  return {
    gsc: {
      spojeno: gscPodesen(env, tenant), svojstvo: st?.svojstvo ?? (gscPodesen(env, tenant) ? String(env.GSC_SVOJSTVO).trim() : null), racun: st?.racun ?? null,
      zadnje: st?.zadnje ?? null, zadnjeUspjesno: st?.zadnje_uspjesno ?? null, greska: st?.greska ?? null,
      upozorenja: parse(st?.upozorenja_json) || [], doDatuma: st?.do_datuma ?? null,
    },
    ...izracunajWeb({
      razdoblja: Object.fromEntries(raz.results.map((r) => [r.oznaka, r])), dani: dani.results, stavke: stavke.results,
      sitemapi: sm.results, adrese: adrese.results,
    }),
  };
}
