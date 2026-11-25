/* Dashboard: statični front-end (public/) + API (/api/*) iznad iste D1 baze kao MCP.
 * Čovjek je jedini koji odobrava odluke, upisuje tjedne i zadaje zadatke; to je ovdje, ne u MCP-u. */
import { korisnik } from './auth.js';
import { apiPoslovanje } from './poslovanje.js';
import { parraPodesena, sinkronizirajParru } from '../../../packages/poslovanje/parra.js';
import { metaPodesena, sinkronizirajMetu } from '../../../packages/poslovanje/meta.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const greska = (poruka, status = 400) => json({ greska: poruka }, status);
const sada = () => new Date().toISOString();
const novi = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const parse = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };
const AGENTI = ['koordinator', 'konkurencija', 'seo', 'ai', 'sadrzaj', 'lokalno', 'oglasi', 'materijal', 'claude'];

const all = async (env, sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
const one = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).first();
const audit = (env, u, tenant, akcija, entitet, id, prije, poslije) =>
  env.DB.prepare(
    `INSERT INTO audit_log (tenant_id, kad, akter, akcija, entitet, entitet_id, prije_json, poslije_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(tenant, sada(), `user:${u.id}`, akcija, entitet, id,
    prije == null ? null : JSON.stringify(prije), poslije == null ? null : JSON.stringify(poslije));
const dnevnik = (env, tenant, sto) =>
  env.DB.prepare(`INSERT INTO aktivnost (id, tenant_id, kad, agent, sto) VALUES (?, ?, ?, 'ti', ?)`)
    .bind(novi(), tenant, sada(), sto.slice(0, 500));

/** Oblik dokumenata isti je kao u staroj ploči (camelCase), pa front-end ostaje gotovo isti. */
async function stanje(env, t) {
  const mjesecOd = `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;
  const [odluke, zadaci, tjedni, mjesecno, faze, stavke, aktivnost, konkurenti, pokretanja, izvjestaji, potrosnja, tenantRed, poAgentu] = await Promise.all([
    all(env, `SELECT * FROM odluke WHERE tenant_id = ?`, t),
    all(env, `SELECT * FROM zadaci WHERE tenant_id = ?`, t),
    all(env, `SELECT * FROM tjedni WHERE tenant_id = ? ORDER BY tjedan`, t),
    all(env, `SELECT * FROM mjesecno WHERE tenant_id = ? ORDER BY mjesec`, t),
    all(env, `SELECT * FROM napredak_faze WHERE tenant_id = ? ORDER BY red`, t),
    all(env, `SELECT * FROM napredak_stavke WHERE tenant_id = ? ORDER BY faza_id, red`, t),
    all(env, `SELECT * FROM aktivnost WHERE tenant_id = ? ORDER BY kad DESC LIMIT 40`, t),
    all(env, `SELECT * FROM konkurenti WHERE tenant_id = ? ORDER BY red`, t),
    all(env, `SELECT id, agent, status, vrsta, opis, kreirano, pocetak, kraj, koraka, pretrage, trosak_usd, greska, rezultat, zadatak_id
              FROM pokretanja WHERE tenant_id = ? ORDER BY kreirano DESC LIMIT 50`, t),
    all(env, `SELECT id, agent, kad, naslov FROM izvjestaji WHERE tenant_id = ? ORDER BY kad DESC LIMIT 12`, t),
    one(env, `SELECT COALESCE(SUM(trosak_usd), 0) AS s FROM pokretanja WHERE tenant_id = ? AND kreirano >= ?`, t, mjesecOd),
    one(env, `SELECT postavke_json FROM tenants WHERE id = ?`, t),
    all(env, `SELECT agent, COUNT(*) AS n, COALESCE(SUM(trosak_usd), 0) AS usd, MAX(kreirano) AS zadnje FROM pokretanja WHERE tenant_id = ? AND kreirano >= ? GROUP BY agent`, t, mjesecOd),
  ]);
  const post = parse(tenantRed?.postavke_json) || {};
  return {
    potrosnja: { mjesec: mjesecOd.slice(0, 7), potroseno: Math.round(potrosnja.s * 100) / 100, limit: Number.isFinite(+post.limit_usd) ? +post.limit_usd : 20, raspored: post.raspored === true,
      poAgentu: Object.fromEntries(poAgentu.map((x) => [x.agent, { pokretanja: x.n, usd: Math.round(x.usd * 100) / 100, zadnje: x.zadnje }])) },
    pokretanja: pokretanja.map((p) => ({
      id: p.id, agent: p.agent, status: p.status, vrsta: p.vrsta, opis: p.opis, kreirano: p.kreirano, kraj: p.kraj, koraka: p.koraka,
      pretrage: p.pretrage, trosak: p.trosak_usd, greska: p.greska, rezultat: p.rezultat, zadatakId: p.zadatak_id,
    })),
    izvjestaji: izvjestaji.map((x) => ({ id: x.id, agent: x.agent, kad: x.kad, naslov: x.naslov })),
    odluke: odluke.map((o) => ({
      id: o.id, naslov: o.naslov, agent: o.agent, razlog: o.razlog, prijedlog: o.prijedlog, poveznica: o.poveznica,
      poveznicaTekst: o.poveznica_tekst, prioritet: o.prioritet, status: o.status, kreirano: o.kreirano,
      komentar: o.komentar, odlucenoAt: o.odluceno_at, rezultat: o.rezultat,
    })),
    zadaci: zadaci.map((z) => ({
      id: z.id, opis: z.opis, agent: z.agent, rok: z.rok, status: z.status, kreirano: z.kreirano,
      sesija: z.sesija ? { url: z.sesija } : null, rezultat: z.rezultat, poveznica: z.poveznica,
    })),
    tjedni: tjedni.map((t2) => ({
      id: t2.tjedan, od: t2.od, upitiBanner: t2.upiti_banner, upitiIgraonica: t2.upiti_igraonica, narudzbe: t2.narudzbe,
      rezervacije: t2.rezervacije, recenzije: t2.recenzije, izvori: parse(t2.izvori_json) ?? {},
    })),
    mjesecno: mjesecno.map((m) => ({
      id: m.mjesec, aiSpominjanja: m.ai_spominjanja, aiPitanja: m.ai_pitanja,
      gscKlikovi: m.gsc_klikovi, gscPojavljivanja: m.gsc_pojavljivanja, napomena: m.napomena,
    })),
    napredak: faze.map((f) => ({
      id: f.id, naziv: f.naziv, kad: f.kad, red: f.red,
      stavke: stavke.filter((s) => s.faza_id === f.id).map((s) => ({ t: s.t, gotovo: !!s.gotovo, tko: s.tko })),
    })),
    aktivnost: aktivnost.map((a) => ({ id: a.id, kad: a.kad, agent: a.agent, sto: a.sto, poveznica: a.poveznica })),
    konkurenti: konkurenti.map((k) => ({
      id: k.id, naziv: k.naziv, mi: !!k.mi, trziste: k.trziste, razina: k.razina, red: k.red, izvor: k.izvor,
      provjereno: k.provjereno, proizvod: k.proizvod, cijenaTekst: k.cijena_tekst, velicina: k.velicina,
      vrsta: k.vrsta, mjesto: k.mjesto, napomena: k.napomena,
      usporedba: parse(k.usporedba_json), prednosti: parse(k.prednosti_json),
    })),
  };
}

const broj = (v, ime) => {
  if (v == null || v === '') return null;
  if (!Number.isInteger(v) || v < 0 || v > 1e6) throw new Error(`${ime} mora biti cijeli broj ≥ 0`);
  return v;
};
const tekst = (v, ime, max, obavezno = false) => {
  if (v == null || v === '') { if (obavezno) throw new Error(`Nedostaje: ${ime}`); return null; }
  if (typeof v !== 'string' || v.length > max) throw new Error(`${ime}: najviše ${max} znakova`);
  return v;
};

async function api(request, env, u, tenant, putanja) {
  const m = request.method;
  let r;

  if (m === 'GET' && putanja === '/api/stanje') return json({ tenant, ...(await stanje(env, tenant)) });

  const body = m === 'GET' ? {} : await request.json().catch(() => ({}));

  // Narudžbe, kalendar, skladište i norme (faza B)
  const posl = await apiPoslovanje(request, env, u, tenant, putanja, body, { json, greska, audit, dnevnik, novi, sada });
  if (posl) return posl;

  // Odobri / odbij odluku
  if (m === 'POST' && (r = /^\/api\/odluke\/([\w-]+)\/odluka$/.exec(putanja))) {
    if (!['odobreno', 'odbijeno'].includes(body.status)) return greska('status mora biti odobreno ili odbijeno');
    const o = await one(env, `SELECT * FROM odluke WHERE tenant_id = ? AND id = ?`, tenant, r[1]);
    if (!o) return greska('Odluka ne postoji', 404);
    if (o.status !== 'ceka') return greska('Odluka je već riješena', 409);
    const komentar = tekst(body.komentar, 'komentar', 2000)?.trim() || null;
    const kad = sada();
    const upd = await env.DB.prepare(
      `UPDATE odluke SET status = ?, komentar = ?, odluceno_at = ?, odlucio_user_id = ?, version = version + 1
       WHERE tenant_id = ? AND id = ? AND status = 'ceka'`,
    ).bind(body.status, komentar, kad, u.id, tenant, r[1]).run();
    if (!upd.meta.changes) return greska('Odluka je već riješena', 409);
    await env.DB.batch([
      audit(env, u, tenant, `odluka_${body.status}`, 'odluke', r[1], { status: 'ceka' }, { status: body.status, komentar }),
      dnevnik(env, tenant, `${body.status === 'odobreno' ? 'Odobreno' : 'Odbijeno'}: ${o.naslov}`),
    ]);
    return json({ ok: true });
  }

  // Novi zadatak
  if (m === 'POST' && putanja === '/api/zadaci') {
    if (!AGENTI.includes(body.agent)) return greska('Nepoznat agent');
    const opis = tekst(body.opis, 'opis', 2000, true);
    if (opis.trim().length < 5) return greska('Opiši zadatak u barem jednoj rečenici');
    const rok = tekst(body.rok, 'rok', 10);
    const id = novi();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO zadaci (id, tenant_id, opis, agent, rok, status, kreirano) VALUES (?, ?, ?, ?, ?, 'novo', ?)`)
        .bind(id, tenant, opis.trim(), body.agent, rok, sada()),
      audit(env, u, tenant, 'novi_zadatak', 'zadaci', id, null, { agent: body.agent, opis }),
      dnevnik(env, tenant, `Novi zadatak za ${body.agent}: ${opis.slice(0, 120)}`),
    ]);
    return json({ id });
  }

  // Zatvori / otkaži zadatak
  if (m === 'POST' && (r = /^\/api\/zadaci\/([\w-]+)\/status$/.exec(putanja))) {
    if (!['gotovo', 'odbijeno'].includes(body.status)) return greska('status mora biti gotovo ili odbijeno');
    const z = await one(env, `SELECT status FROM zadaci WHERE tenant_id = ? AND id = ?`, tenant, r[1]);
    if (!z) return greska('Zadatak ne postoji', 404);
    if (!['novo', 'u_izradi'].includes(z.status)) return greska('Zadatak je već zatvoren', 409);
    await env.DB.batch([
      env.DB.prepare(`UPDATE zadaci SET status = ?, version = version + 1 WHERE tenant_id = ? AND id = ?`).bind(body.status, tenant, r[1]),
      audit(env, u, tenant, 'zadatak_status', 'zadaci', r[1], { status: z.status }, { status: body.status }),
    ]);
    return json({ ok: true });
  }

  // Pokretanje agenta (izvršitelj preko service bindinga)
  const izvrsitelj = async (put, tijelo) => {
    if (!env.EXEC || !env.INTERNI_KLJUC) return greska('Izvršitelj nije spojen. Zadatak preuzima koordinator u idućem pregledu.', 503);
    const odg = await env.EXEC.fetch(`https://izvrsitelj${put}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-interni-kljuc': env.INTERNI_KLJUC },
      body: JSON.stringify({ tenant, ...tijelo }),
    });
    const d = await odg.json().catch(() => ({}));
    if (!odg.ok) return greska(d.greska || `Izvršitelj: greška ${odg.status}`, odg.status === 403 ? 502 : odg.status);
    await env.DB.batch([audit(env, u, tenant, 'pokretanje', 'pokretanja', d.pokretanje_id, null, { put, ...tijelo })]);
    return json({ ok: true, pokretanje_id: d.pokretanje_id });
  };
  if (m === 'POST' && (r = /^\/api\/zadaci\/([\w-]+)\/pokreni$/.exec(putanja))) return izvrsitelj('/zadatak', { zadatak_id: r[1] });
  if (m === 'POST' && putanja === '/api/pregled') return izvrsitelj('/pregled', { vrsta: body.vrsta === 'mjesecni' ? 'mjesecni' : 'tjedni' });

  // Cijeli tekst izvještaja
  if (m === 'GET' && (r = /^\/api\/izvjestaj\/([\w-]+)$/.exec(putanja))) {
    const x = await one(env, `SELECT id, agent, kad, naslov, tijelo FROM izvjestaji WHERE tenant_id = ? AND id = ?`, tenant, r[1]);
    return x ? json(x) : greska('Izvještaj ne postoji', 404);
  }

  // Tjedne brojke (samo čovjek)
  if (m === 'PUT' && (r = /^\/api\/tjedni\/(\d{4}-W\d{2})$/.exec(putanja))) {
    const iz = body.izvori || {};
    const izvori = {};
    for (const k of ['instagram', 'facebook', 'google', 'ai', 'preporuka', 'ostalo']) izvori[k] = broj(iz[k], k) ?? 0;
    const stari = await one(env, `SELECT * FROM tjedni WHERE tenant_id = ? AND tjedan = ?`, tenant, r[1]);
    const n = {
      od: tekst(body.od, 'od', 10), upiti_banner: broj(body.upitiBanner, 'upitiBanner') ?? 0,
      upiti_igraonica: broj(body.upitiIgraonica, 'upitiIgraonica') ?? 0, narudzbe: broj(body.narudzbe, 'narudzbe') ?? 0,
      rezervacije: broj(body.rezervacije, 'rezervacije') ?? 0, recenzije: broj(body.recenzije, 'recenzije'),
    };
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tjedni (tenant_id, tjedan, od, upiti_banner, upiti_igraonica, narudzbe, rezervacije, recenzije, izvori_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, tjedan) DO UPDATE SET od = excluded.od, upiti_banner = excluded.upiti_banner,
           upiti_igraonica = excluded.upiti_igraonica, narudzbe = excluded.narudzbe, rezervacije = excluded.rezervacije,
           recenzije = excluded.recenzije, izvori_json = excluded.izvori_json`,
      ).bind(tenant, r[1], n.od, n.upiti_banner, n.upiti_igraonica, n.narudzbe, n.rezervacije, n.recenzije, JSON.stringify(izvori)),
      audit(env, u, tenant, 'upis_tjedna', 'tjedni', r[1], stari ?? null, { ...n, izvori }),
    ]);
    return json({ ok: true });
  }

  // Kvačica na stavci plana
  if (m === 'POST' && (r = /^\/api\/napredak\/([\w-]+)\/(\d+)$/.exec(putanja))) {
    const st = await one(env, `SELECT gotovo FROM napredak_stavke WHERE tenant_id = ? AND faza_id = ? AND red = ?`, tenant, r[1], +r[2]);
    if (!st) return greska('Stavka ne postoji', 404);
    await env.DB.batch([
      env.DB.prepare(`UPDATE napredak_stavke SET gotovo = ? WHERE tenant_id = ? AND faza_id = ? AND red = ?`)
        .bind(body.gotovo ? 1 : 0, tenant, r[1], +r[2]),
      audit(env, u, tenant, 'napredak', 'napredak_stavke', `${r[1]}/${r[2]}`, { gotovo: !!st.gotovo }, { gotovo: !!body.gotovo }),
    ]);
    return json({ ok: true });
  }

  return greska('Nepoznata adresa', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // Zaštita od CSRF-a: pisanje samo JSON-om i samo s istog izvora.
    if (request.method !== 'GET') {
      const origin = request.headers.get('origin');
      if (origin && new URL(origin).host !== url.host) return greska('Zabranjeno', 403);
      if (!(request.headers.get('content-type') || '').includes('application/json')) return greska('Očekivan JSON', 415);
    }

    const u = await korisnik(request, env);
    if (u.greska) return u.greska;

    const tenanti = await all(env, `SELECT id, naziv FROM tenants ORDER BY naziv`);
    if (url.pathname === '/api/ja') {
      const vidljivi = u.uloga === 'savjetnik' ? tenanti : tenanti.filter((t) => t.id === u.tenant_id);
      return json({ email: u.email, uloga: u.uloga, tenanti: vidljivi });
    }

    // Zakupac: vlasnik samo svoj; savjetnik bira (zaglavlje X-Tenant).
    let tenant = u.tenant_id;
    if (u.uloga === 'savjetnik') {
      tenant = request.headers.get('x-tenant') || tenanti[0]?.id;
      if (!tenanti.some((t) => t.id === tenant)) return greska('Nepoznat zakupac', 404);
    }
    if (!tenant) return greska('Korisnik nema zakupca', 403);

    try {
      return await api(request, env, u, tenant, url.pathname);
    } catch (e) {
      return greska(String(e.message || e), 400);
    }
  },

  // Svakih 30 minuta: ponude i uplate iz Parre. Svakih 6 sati (u 15 min): Instagram i Facebook. Bez tajni ne radi ništa.
  async scheduled(event, env, ctx) {
    if (event?.cron === META_CRON) {
      const t = env.META_ZAKUPAC || 'piccolini';
      if (metaPodesena(env, t)) ctx.waitUntil(sinkronizirajMetu(env, t));
      return;
    }
    const tenant = env.PARRA_ZAKUPAC || 'piccolini';
    if (parraPodesena(env, tenant)) ctx.waitUntil(sinkronizirajParru(env, tenant));
  },
};
const META_CRON = '15 */6 * * *';
