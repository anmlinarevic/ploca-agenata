/* API faze B: narudžbe, kalendar, skladište i norme. Logika je u packages/poslovanje; ovdje su baza, provjere i zapis.
 * Sve piše čovjek (vlasnik ili savjetnik). Agenti ovo za sada samo čitaju preko MCP-a. */
import {
  OPIS_NORMI, ZADANE_NORME, NAZIV_STANJA, dopustenPrijelaz, trebaKnjizitiPotrosnju,
  normalizirajStavku, potrosnjaNarudzbe, stanjeSkladista, maskirajStavke, zagrebUUtc,
} from '../../../packages/poslovanje/index.js';
import { narudzbaIzReda, ucitaj, pregled } from '../../../packages/poslovanje/baza.js';
import { parraPodesena, sinkronizirajParru } from '../../../packages/poslovanje/parra.js';
import { metaPodesena, sinkronizirajMetu, pregledMreza } from '../../../packages/poslovanje/meta.js';
import { popisRacuna, dodajRacun, ukloniRacun } from '../../../packages/poslovanje/racuni.js';
import { pregledFinancija } from '../../../packages/poslovanje/financije.js';
import { pregledProdaje } from '../../../packages/poslovanje/prodaja.js';
import { gscPodesen, sinkronizirajGsc, pregledWeba } from '../../../packages/poslovanje/gsc.js';

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const LOKALNO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DOSTAVE = ['preuzimanje', 'boxnow', 'osobno', 'montaza'];

function tekst(v, ime, max, obavezno = false) {
  if (v == null || v === '') { if (obavezno) throw new Error(`Nedostaje: ${ime}`); return null; }
  if (typeof v !== 'string' || v.length > max) throw new Error(`${ime}: najviše ${max} znakova`);
  return v.trim();
}
const bezOsobnih = (s, ime) => {
  if (s && (/@/.test(s) || /(\+?\d[\d\s/-]{7,}\d)/.test(s))) throw new Error(`${ime}: bez e-maila i telefona kupca (ostaju u Gmailu i programu za račune)`);
  return s;
};
const brojIli = (v, ime, min, max) => {
  if (v == null || v === '') return null;
  const x = +v;
  if (!Number.isFinite(x) || x < min || x > max) throw new Error(`${ime}: broj od ${min} do ${max}`);
  return x;
};

/** Provjera unosa narudžbe; `stara` je postojeća narudžba pri izmjeni. */
function provjeri(body, stara, artikli, n) {
  const usluga = stara?.usluga ?? body.usluga;
  if (!['sivanje', 'igraonica'].includes(usluga)) throw new Error('usluga mora biti sivanje ili igraonica');
  const v = (k) => (k in body ? body[k] : stara?.[k]);
  const opis = bezOsobnih(tekst(v('opis'), 'opis', 120, true), 'Opis');
  if (opis.length < 3) throw new Error('Opis: barem 3 znaka');
  const out = {
    usluga, opis,
    napomena: bezOsobnih(tekst(v('napomena'), 'napomena', 500), 'Napomena'),
    vrijednost_eur: brojIli(v('vrijednost_eur'), 'vrijednost', 0, 100000),
    sifra_racuna: tekst(v('sifra_racuna'), 'šifra računa', 40),
    dostava: v('dostava') ?? null,
  };
  if (out.dostava != null && !DOSTAVE.includes(out.dostava)) throw new Error(`dostava: ${DOSTAVE.join(', ')}`);
  if (usluga === 'sivanje') {
    const rok = v('rok');
    if (rok != null && rok !== '' && !DATUM.test(rok)) throw new Error('rok: YYYY-MM-DD');
    out.rok = rok || null;
    const tkanine = new Set(artikli.filter((a) => a.kategorija === 'tkanina').map((a) => a.id));
    const stavke = Array.isArray(v('stavke')) ? v('stavke') : [];
    if (stavke.length > 10) throw new Error('Najviše 10 stavki po narudžbi');
    // Već spremljene stavke su provjerene; ponovno se provjeravaju samo nove.
    out.stavke = 'stavke' in body ? stavke.map((s) => normalizirajStavku(s, (d) => tkanine.has(d))) : (stara?.stavke ?? []);
    const izrada = Array.isArray(v('izrada')) ? v('izrada') : [];
    if (izrada.length > 10) throw new Error('Najviše 10 dana izrade');
    out.izrada = izrada.map((x) => {
      if (!DATUM.test(x?.dan || '')) throw new Error('izrada: dan YYYY-MM-DD');
      return { dan: x.dan, sati: brojIli(x.sati, 'sati izrade', 0.25, 12) ?? 1 };
    }).sort((a, b) => (a.dan < b.dan ? -1 : 1));
    out.sati_procjena = brojIli(v('sati_procjena'), 'procjena sati', 0, 200);
    if (out.sati_procjena == null && out.stavke.length) out.sati_procjena = potrosnjaNarudzbe({ ...out }, n).sati;
    out.termin_od = out.termin_do = out.opcija_do = null;
  } else {
    const od = v('termin_od'), d = v('termin_do');
    if (!LOKALNO.test(od || '')) throw new Error('termin_od: YYYY-MM-DDTHH:MM');
    if (d && !LOKALNO.test(d)) throw new Error('termin_do: YYYY-MM-DDTHH:MM');
    if (d && d <= od) throw new Error('Termin mora završiti nakon početka');
    out.termin_od = od; out.termin_do = d || null;
    const op = v('opcija_do');
    // Opcija se upisuje kao lokalno vrijeme (obrazac), a čuva u UTC-u radi točnog odbrojavanja.
    out.opcija_do = !op ? null : LOKALNO.test(op) ? zagrebUUtc(op) : (!Number.isNaN(Date.parse(op)) ? new Date(op).toISOString() : (() => { throw new Error('opcija_do: YYYY-MM-DDTHH:MM'); })());
    out.rok = null; out.stavke = []; out.izrada = []; out.sati_procjena = null;
  }
  return out;
}

async function sljedecaSifra(env, tenant, usluga) {
  const p = usluga === 'sivanje' ? 'N-' : 'R-';
  const r = await env.DB.prepare(`SELECT sifra FROM narudzbe WHERE tenant_id = ? AND sifra LIKE ? ORDER BY length(sifra) DESC, sifra DESC LIMIT 1`)
    .bind(tenant, `${p}%`).first();
  const n = r ? parseInt(r.sifra.slice(2), 10) + 1 : 1;
  return p + String(n).padStart(usluga === 'sivanje' ? 4 : 3, '0');
}

/** Vraća Response ili null ako putanja nije njegova. h = pomoćne funkcije iz index.js. */
export async function apiPoslovanje(request, env, u, tenant, putanja, body, h) {
  const { json, greska, audit, dnevnik, novi, sada } = h;
  const m = request.method;
  let r;
  const tko = `user:${u.id}`;

  if (m === 'GET' && putanja === '/api/poslovanje') {
    const q = new URL(request.url).searchParams;
    return json(await pregled(env, tenant, q.get('od'), q.get('pogled') === 'mjesec' ? 'mjesec' : 'tjedan'));
  }

  // ---- Parra: ručno osvježavanje (inače svakih 30 min preko crona) ----
  if (m === 'POST' && putanja === '/api/parra/osvjezi') {
    if (!parraPodesena(env, tenant)) return greska('Parra nije spojena. Upiši ključ: npx wrangler secret put PARRA_API_KLJUC', 503);
    const r = await sinkronizirajParru(env, tenant);
    await env.DB.batch([audit(env, u, tenant, 'parra_osvjezi', 'parra_ponude', null, null, { promijenjeno: r.promijenjeno, greska: r.greska })]);
    return r.ok ? json(r) : greska(r.greska, 502);
  }

  // ---- Meta (Instagram i Facebook stranica): pregled i ručno osvježavanje (inače svakih 6 sati preko crona) ----
  if (m === 'GET' && putanja === '/api/mreze') {
    const q = new URL(request.url).searchParams;
    try { return json(await pregledMreza(env, tenant, new Date(), { dana: q.get('dana'), od: q.get('od'), do: q.get('do') })); }
    catch (e) { return greska(String(e.message || e), 400); }
  }
  if (m === 'GET' && putanja === '/api/financije') {
    const q = new URL(request.url).searchParams;
    try { return json(await pregledFinancija(env, tenant, new Date(), { mjeseci: q.get('mjeseci'), od: q.get('od'), do: q.get('do') })); }
    catch (e) { return greska(String(e.message || e), 400); }
  }
  if (m === 'GET' && putanja === '/api/prodaja') {
    const q = new URL(request.url).searchParams;
    try { return json(await pregledProdaje(env, tenant, new Date(), { dana: q.get('dana'), od: q.get('od'), do: q.get('do') })); }
    catch (e) { return greska(String(e.message || e), 400); }
  }
  if (m === 'POST' && putanja === '/api/meta/osvjezi') {
    if (!metaPodesena(env, tenant)) return greska('Meta nije spojena. Upiši token: npx wrangler secret put META_TOKEN', 503);
    const r = await sinkronizirajMetu(env, tenant, { racunId: typeof body?.racun === 'string' ? body.racun : null });
    await env.DB.batch([audit(env, u, tenant, 'meta_osvjezi', 'meta_objave', body?.racun ?? null, null, { objava: r.objava, uvida: r.uvida, greska: r.greska })]);
    return r.ok ? json(r) : greska(r.greska, 502);
  }

  // ---- Računi na mrežama: popis, dodavanje i uklanjanje (vlasnik ili savjetnik). Podaci uklonjenog računa ostaju u bazi. ----
  if (m === 'GET' && putanja === '/api/racuni') return json({ racuni: await popisRacuna(env.DB, tenant) });
  if (m === 'POST' && putanja === '/api/racuni') {
    try {
      const dodano = await dodajRacun(env.DB, tenant, body || {});
      await env.DB.batch(dodano.map((d) => audit(env, u, tenant, 'racun_dodan', 'racuni', d.id, null, { mreza: d.mreza, naziv: d.naziv, usluga: body.usluga ?? 'oboje' })));
      return json({ dodano, racuni: await popisRacuna(env.DB, tenant) });
    } catch (e) {
      return greska(String(e.message || e), /UNIQUE|već dodan/i.test(String(e.message)) ? 409 : 400);
    }
  }
  const rac = /^\/api\/racuni\/([\w-]{1,40})$/.exec(putanja);
  if (m === 'DELETE' && rac) {
    const uklonjen = await ukloniRacun(env.DB, tenant, rac[1]);
    if (!uklonjen) return greska('Račun ne postoji ili je već uklonjen', 404);
    await env.DB.batch([audit(env, u, tenant, 'racun_uklonjen', 'racuni', rac[1], null, null)]);
    return json({ ok: true, racuni: await popisRacuna(env.DB, tenant) });
  }

  // ---- Google Search Console: pregled i ručno osvježavanje (inače jednom dnevno preko crona) ----
  if (m === 'GET' && putanja === '/api/web') {
    const q = new URL(request.url).searchParams;
    try { return json(await pregledWeba(env, tenant, new Date(), { dana: q.get('dana'), od: q.get('od'), do: q.get('do') })); }
    catch (e) { return greska(String(e.message || e), 400); }
  }
  if (m === 'POST' && putanja === '/api/gsc/osvjezi') {
    if (!gscPodesen(env, tenant)) return greska('Search Console nije spojen. Upute: docs/GSC-SPAJANJE.md', 503);
    const r = await sinkronizirajGsc(env, tenant);
    await env.DB.batch([audit(env, u, tenant, 'gsc_osvjezi', 'gsc_stavke', null, null, { stavki: r.stavki, provjereno: r.provjereno, greska: r.greska })]);
    return r.ok ? json(r) : greska(r.greska, 502);
  }

  // ---- narudžbe ----
  if (m === 'POST' && putanja === '/api/narudzbe') {
    const { artikli, n } = await ucitaj(env, tenant);
    const d = provjeri(body, null, artikli, n);
    const pocetna = d.usluga === 'sivanje' ? ['upit', 'ponuda', 'potvrdjeno'] : ['upit', 'opcija', 'potvrdjeno'];
    const stanje = body.stanje ?? (d.usluga === 'sivanje' ? 'potvrdjeno' : 'opcija');
    if (!pocetna.includes(stanje)) return greska(`Nova narudžba može početi kao: ${pocetna.join(', ')}`);
    const id = novi(), kad = sada(), sifra = await sljedecaSifra(env, tenant, d.usluga);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO narudzbe (tenant_id, id, sifra, usluga, opis, stanje, rok, termin_od, termin_do, opcija_do, izrada_json,
        sati_procjena, dostava, vrijednost_eur, sifra_racuna, stavke_json, napomena, kreirano, azurirano)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(tenant, id, sifra, d.usluga, d.opis, stanje, d.rok, d.termin_od, d.termin_do, d.opcija_do, JSON.stringify(d.izrada),
          d.sati_procjena, d.dostava, d.vrijednost_eur, d.sifra_racuna, JSON.stringify(d.stavke), d.napomena, kad, kad),
      env.DB.prepare(`INSERT INTO narudzbe_povijest (tenant_id, narudzba_id, kad, prije, poslije, tko) VALUES (?, ?, ?, NULL, ?, ?)`)
        .bind(tenant, id, kad, stanje, tko),
      audit(env, u, tenant, 'nova_narudzba', 'narudzbe', id, null, { sifra, ...d }),
      dnevnik(env, tenant, `Nova narudžba ${sifra}: ${d.opis} (${NAZIV_STANJA[stanje].toLowerCase()})`),
    ]);
    return json({ id, sifra });
  }

  if ((m === 'PUT' || m === 'POST') && (r = /^\/api\/narudzbe\/([\w-]+)(\/stanje)?$/.exec(putanja))) {
    const red = await env.DB.prepare(`SELECT * FROM narudzbe WHERE tenant_id = ? AND id = ?`).bind(tenant, r[1]).first();
    if (!red) return greska('Narudžba ne postoji', 404);
    const stara = narudzbaIzReda(red);
    if (body.version != null && body.version !== stara.version) return greska('Narudžbu je u međuvremenu netko promijenio. Osvježi.', 409);
    const kad = sada();

    // promjena stanja
    if (m === 'POST' && r[2]) {
      const novo = body.stanje;
      if (!dopustenPrijelaz(stara.usluga, stara.stanje, novo)) return greska(`Nije moguće iz „${NAZIV_STANJA[stara.stanje]}” u „${NAZIV_STANJA[novo] ?? novo}”`, 409);
      const naredbe = [];
      let stavke = stara.stavke;
      if (trebaKnjizitiPotrosnju(stara.usluga, novo)) {
        const vec = await env.DB.prepare(`SELECT COUNT(*) AS c FROM skladiste_kretanja WHERE tenant_id = ? AND narudzba_id = ? AND vrsta = 'potrosnja'`)
          .bind(tenant, stara.id).first();
        if (!vec.c) {
          const { artikli, n } = await ucitaj(env, tenant);
          const postoji = new Set(artikli.map((a) => a.id));
          for (const [artikl, kolicina] of Object.entries(potrosnjaNarudzbe(stara, n).po)) {
            if (!postoji.has(artikl)) continue;
            naredbe.push(env.DB.prepare(`INSERT INTO skladiste_kretanja (tenant_id, id, artikl_id, vrsta, kolicina, kad, narudzba_id, napomena, tko)
              VALUES (?, ?, ?, 'potrosnja', ?, ?, ?, ?, 'sustav')`).bind(tenant, novi(), artikl, kolicina, kad, stara.id, `Narudžba ${stara.sifra}`));
          }
        }
      }
      if (novo === 'isporuceno') stavke = maskirajStavke(stavke);
      const upd = await env.DB.prepare(`UPDATE narudzbe SET stanje = ?, stavke_json = ?, azurirano = ?, version = version + 1
        WHERE tenant_id = ? AND id = ? AND version = ?`).bind(novo, JSON.stringify(stavke), kad, tenant, stara.id, stara.version).run();
      if (!upd.meta.changes) return greska('Narudžbu je u međuvremenu netko promijenio. Osvježi.', 409);
      await env.DB.batch([
        ...naredbe,
        env.DB.prepare(`INSERT INTO narudzbe_povijest (tenant_id, narudzba_id, kad, prije, poslije, tko) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(tenant, stara.id, kad, stara.stanje, novo, tko),
        audit(env, u, tenant, 'narudzba_stanje', 'narudzbe', stara.id, { stanje: stara.stanje }, { stanje: novo }),
        dnevnik(env, tenant, `${stara.sifra} (${stara.opis}): ${NAZIV_STANJA[novo].toLowerCase()}`),
      ]);
      return json({ ok: true, stanje: novo, potrosnjaKnjizena: naredbe.length });
    }

    // izmjena podataka
    if (m === 'PUT' && !r[2]) {
      if (['isporuceno', 'odradjeno', 'otkazano'].includes(stara.stanje)) return greska('Završena narudžba se ne mijenja', 409);
      if ('stavke' in body && ['u_izradi', 'gotovo'].includes(stara.stanje)) return greska('Tkanina je već izrezana: stavke se više ne mijenjaju', 409);
      const { artikli, n } = await ucitaj(env, tenant);
      const d = provjeri(body, stara, artikli, n);
      const upd = await env.DB.prepare(`UPDATE narudzbe SET opis = ?, rok = ?, termin_od = ?, termin_do = ?, opcija_do = ?, izrada_json = ?,
        sati_procjena = ?, dostava = ?, vrijednost_eur = ?, sifra_racuna = ?, stavke_json = ?, napomena = ?, azurirano = ?, version = version + 1
        WHERE tenant_id = ? AND id = ? AND version = ?`)
        .bind(d.opis, d.rok, d.termin_od, d.termin_do, d.opcija_do, JSON.stringify(d.izrada), d.sati_procjena, d.dostava, d.vrijednost_eur,
          d.sifra_racuna, JSON.stringify(d.stavke), d.napomena, kad, tenant, stara.id, stara.version).run();
      if (!upd.meta.changes) return greska('Narudžbu je u međuvremenu netko promijenio. Osvježi.', 409);
      await env.DB.batch([audit(env, u, tenant, 'narudzba_izmjena', 'narudzbe', stara.id, stara, d)]);
      return json({ ok: true });
    }
  }

  // ---- izračun bez spremanja (konfigurator na ploči) ----
  if (m === 'POST' && putanja === '/api/izracun') {
    const { artikli, kretanja, narudzbe, n } = await ucitaj(env, tenant);
    const tkanine = new Set(artikli.filter((a) => a.kategorija === 'tkanina').map((a) => a.id));
    const stavke = (Array.isArray(body.stavke) ? body.stavke : []).slice(0, 10).map((s) => normalizirajStavku(s, (d) => tkanine.has(d)));
    const p = potrosnjaNarudzbe({ stavke, dostava: body.dostava }, n);
    const sk = new Map(stanjeSkladista(artikli, kretanja, narudzbe, n).map((a) => [a.id, a]));
    const stavkeIzracuna = Object.entries(p.po).map(([artikl, kolicina]) => {
      const a = sk.get(artikl);
      return { artikl, naziv: a?.naziv ?? artikl, jedinica: a?.jedinica, kolicina, raspolozivo: a?.raspolozivo ?? null,
        nakon: a ? Math.round((a.raspolozivo - kolicina) * 10000) / 10000 : null, dovoljno: a ? a.raspolozivo >= kolicina : null, poznato: a?.status !== 'nepoznato' };
    });
    return json({ sati: p.sati, slova: p.slova, stavke: stavkeIzracuna });
  }

  // ---- skladište ----
  if (m === 'POST' && putanja === '/api/skladiste/kretanja') {
    const a = await env.DB.prepare(`SELECT * FROM artikli WHERE tenant_id = ? AND id = ?`).bind(tenant, body.artikl).first();
    if (!a) return greska('Artikl ne postoji', 404);
    if (!['ulaz', 'inventura', 'otpis', 'povrat', 'potrosnja'].includes(body.vrsta)) return greska('vrsta: ulaz, inventura, otpis, povrat ili potrosnja');
    let kolicina = brojIli(body.kolicina, 'količina', 0, 100000);
    // Tkanina se kupuje u metrima s bale: metri × širina bale = m².
    if (kolicina == null && a.jedinica === 'm2' && body.metri != null) {
      const metri = brojIli(body.metri, 'metri', 0, 1000), sirina = brojIli(body.sirina_cm, 'širina bale', 50, 400) ?? 150;
      kolicina = Math.round(metri * (sirina / 100) * 10000) / 10000;
    }
    if (kolicina == null) return greska('Upiši količinu');
    if (kolicina === 0 && body.vrsta !== 'inventura') return greska('Količina mora biti veća od 0');
    const id = novi(), kad = sada();
    const napomena = bezOsobnih(tekst(body.napomena, 'napomena', 300), 'Napomena');
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO skladiste_kretanja (tenant_id, id, artikl_id, vrsta, kolicina, kad, narudzba_id, napomena, tko)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`).bind(tenant, id, a.id, body.vrsta, kolicina, kad, napomena, tko),
      audit(env, u, tenant, `skladiste_${body.vrsta}`, 'skladiste_kretanja', id, null, { artikl: a.id, kolicina }),
    ]);
    return json({ id, kolicina });
  }

  if (m === 'PUT' && (r = /^\/api\/artikli\/([\w-]+)$/.exec(putanja))) {
    const a = await env.DB.prepare(`SELECT prag FROM artikli WHERE tenant_id = ? AND id = ?`).bind(tenant, r[1]).first();
    if (!a) return greska('Artikl ne postoji', 404);
    const prag = brojIli(body.prag, 'prag', 0, 100000);
    await env.DB.batch([
      env.DB.prepare(`UPDATE artikli SET prag = ? WHERE tenant_id = ? AND id = ?`).bind(prag, tenant, r[1]),
      audit(env, u, tenant, 'artikl_prag', 'artikli', r[1], a, { prag }),
    ]);
    return json({ ok: true });
  }

  if (m === 'PUT' && putanja === '/api/norme') {
    const naredbe = [];
    const kad = sada();
    for (const [k, v] of Object.entries(body || {})) {
      if (!(k in ZADANE_NORME)) return greska(`Nepoznata norma: ${k}`);
      const x = brojIli(v, OPIS_NORMI[k], 0, 1000);
      if (x == null || (k === 'iskoristivost' && (x <= 0 || x > 1)) || (k === 'slojevi' && x < 1)) return greska(`${OPIS_NORMI[k]}: neispravna vrijednost`);
      naredbe.push(env.DB.prepare(`INSERT INTO norme (tenant_id, kljuc, vrijednost, azurirano) VALUES (?, ?, ?, ?)
        ON CONFLICT (tenant_id, kljuc) DO UPDATE SET vrijednost = excluded.vrijednost, azurirano = excluded.azurirano`).bind(tenant, k, x, kad));
    }
    if (!naredbe.length) return greska('Nema promjena');
    await env.DB.batch([...naredbe, audit(env, u, tenant, 'norme', 'norme', 'norme', null, body)]);
    return json({ ok: true });
  }

  return null;
}
