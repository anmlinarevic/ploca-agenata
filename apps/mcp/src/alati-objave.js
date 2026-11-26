/* Alati za objave (Claude izrađuje, vlasnik odobrava na ploči). Pravila:
 * - NEMA alata za odobravanje, objavu ni brisanje: to radi samo čovjek na ploči;
 * - u objavu smije samo materijal iz knjižnice označen kao slobodan (dijete bez pristanka nikad nije slobodno);
 * - mediji idu u R2 preko jednokratne adrese (zatrazi_ucitavanje), Claude nema R2 ključeve. */
import {
  MIME, MAX_BAJTOVA, KANALI, SERIJE, USLUGE, ISO_TJEDAN, MAX_OPIS,
  kljucZa, pripadaZakupcu, planDokument, objavaDokument, knjiznicaDokument, posluziObjekt,
} from '../../../packages/poslovanje/objave.js';

const novi = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const sada = () => new Date().toISOString();
const SAT = 3600 * 1000;
const MAX_UCITAVANJA_DNEVNO = 80;
const MAX_OBJAVA_TJEDNO = 30;
const MAX_SLAJDOVA = 35;

const s = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const tekst = (v, ime, max = 4000, obavezno = false) => {
  if (v == null || v === '') { if (obavezno) throw new Error(`Nedostaje: ${ime}`); return null; }
  if (typeof v !== 'string') throw new Error(`${ime} mora biti tekst`);
  if (v.length > max) throw new Error(`${ime} je predug (najviše ${max} znakova)`);
  return v;
};
const jedan = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).first();
const sve = async (env, sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
const nadzor = (env, ctx, akcija, entitet, id, prije, poslije) =>
  env.DB.prepare(
    `INSERT INTO audit_log (tenant_id, kad, akter, akcija, entitet, entitet_id, prije_json, poslije_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(ctx.tenantId, sada(), `agent:${ctx.agent}`, akcija, entitet, id,
    prije == null ? null : JSON.stringify(prije), poslije == null ? null : JSON.stringify(poslije));
const aktivnost = (env, ctx, sto) =>
  env.DB.prepare(`INSERT INTO aktivnost (id, tenant_id, kad, agent, sto) VALUES (?, ?, ?, ?, ?)`)
    .bind(novi(), ctx.tenantId, sada(), ctx.agent, sto.slice(0, 500));

async function sha256Hex(t) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const tokenPrijenosa = () => {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
function trebaR2(env) { if (!env.MEDIJI) throw new Error('Spremište medija (R2, binding MEDIJI) nije spojeno na MCP.'); }

async function noviPrijenos(env, ctx, smjer, kljuc, mime, maxBajtova) {
  const token = tokenPrijenosa();
  const istice = new Date(Date.now() + 2 * SAT).toISOString();
  await env.DB.prepare(
    `INSERT INTO prijenosi (hash, tenant_id, smjer, kljuc, mime, max_bajtova, agent, istice) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(await sha256Hex(token), ctx.tenantId, smjer, kljuc, mime, maxBajtova, ctx.agent, istice).run();
  return { url: `${ctx.origin}/${smjer === 'gore' ? 'ucitaj' : 'preuzmi'}/${token}`, istice };
}

/** Provjeri medije objave: svi u R2, od ovog zakupca, prave vrste. Vraća [{kljuc, mime, velicina}]. */
async function provjeriMedije(env, ctx, vrsta, mediji) {
  if (!Array.isArray(mediji) || !mediji.length) throw new Error('Objava treba barem jednu datoteku (mediji: popis ključeva iz zatrazi_ucitavanje)');
  if (vrsta === 'video' && mediji.length !== 1) throw new Error('Video objava ima točno jednu datoteku');
  if (vrsta === 'slajdovi' && mediji.length > MAX_SLAJDOVA) throw new Error(`Najviše ${MAX_SLAJDOVA} slajdova`);
  const out = [];
  for (const kljuc of mediji) {
    if (!pripadaZakupcu(ctx.tenantId, kljuc) || !kljuc.startsWith(`${ctx.tenantId}/objave/`)) throw new Error(`Neispravan ključ: ${kljuc}`);
    const h = await env.MEDIJI.head(kljuc);
    if (!h) throw new Error(`Datoteka nije učitana: ${kljuc}`);
    const mime = h.httpMetadata?.contentType || '';
    if (vrsta === 'video' && mime !== 'video/mp4') throw new Error('Video za objavu mora biti MP4 (video/mp4)');
    if (vrsta === 'slajdovi' && !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('Slajdovi moraju biti JPEG, PNG ili WebP');
    out.push({ kljuc, mime, velicina: h.size });
  }
  return out;
}

/** Materijal iz knjižnice smije u objavu samo ako je označen kao slobodan. */
async function provjeriKnjiznicu(env, ctx, ids) {
  if (ids == null) return [];
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw new Error('knjiznica: popis id-jeva');
  for (const id of ids) {
    const k = await jedan(env, `SELECT slobodno, ima_djece, pristanak FROM knjiznica WHERE tenant_id = ? AND id = ?`, ctx.tenantId, id);
    if (!k) throw new Error(`Materijal ${id} ne postoji u knjižnici`);
    if (!k.slobodno) throw new Error(`Materijal ${id} nije označen kao slobodan za objavu`);
  }
  return ids;
}

function provjeriTermin(t) {
  if (t == null || t === '') return null;
  if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) throw new Error('termin mora biti datum i vrijeme (ISO, npr. 2026-12-09T19:00:00+01:00)');
  return new Date(t).toISOString();
}

const objavaSchema = {
  tjedan: { type: 'string', pattern: ISO_TJEDAN.source, description: 'Tjedan plana kojem objava pripada (GGGG-Www)' },
  kanal: { type: 'string', enum: KANALI, default: 'tiktok' },
  serija: { type: 'string', enum: SERIJE },
  vrsta: { type: 'string', enum: ['video', 'slajdovi'] },
  naslov: { type: 'string', description: 'Kratki interni naslov, npr. „Imena: Lucija”' },
  opis: { type: 'string', description: `Tekst objave s hashtagovima, točno kako ide van (najviše ${MAX_OPIS} znakova)` },
  scenarij: { type: 'string', description: 'Kadrovi s vremenima i napomene za vlasnika' },
  termin: { type: 'string', description: 'Predloženo vrijeme objave (ISO)' },
  mediji: { type: 'array', items: { type: 'string' }, description: 'R2 ključevi iz zatrazi_ucitavanje, redom' },
  knjiznica: { type: 'array', items: { type: 'string' }, description: 'id-jevi korištenog materijala iz knjižnice' },
  ai_oznaka: { type: 'boolean', description: 'true ako je model izmislio sliku ili pokret (pri objavi uključiti oznaku AI-generated)' },
};

export const OBJAVE = [
  {
    name: 'zatrazi_ucitavanje',
    description: 'Jednokratna adresa (vrijedi 2 sata) za učitavanje gotovog videa ili slajda u spremište ploče. Učitaj s: curl -X PUT -H "content-type: <mime>" --data-binary @datoteka "<url>". Vraća `kljuc` koji ide u predlozi_objavu. Najviše 95 MB po datoteci.',
    inputSchema: s({ mime: { type: 'string', enum: ['video/mp4', 'image/jpeg', 'image/png', 'image/webp'] } }, ['mime']),
    run: async (a, ctx, env) => {
      trebaR2(env);
      if (!['video/mp4', 'image/jpeg', 'image/png', 'image/webp'].includes(a.mime)) throw new Error('mime: video/mp4, image/jpeg, image/png ili image/webp');
      const { n } = await jedan(env, `SELECT COUNT(*) AS n FROM prijenosi WHERE tenant_id = ? AND smjer = 'gore' AND istice >= ?`,
        ctx.tenantId, new Date(Date.now() - 22 * SAT).toISOString());
      if (n >= MAX_UCITAVANJA_DNEVNO) throw new Error(`Ograničenje: najviše ${MAX_UCITAVANJA_DNEVNO} učitavanja u 24 sata`);
      const kljuc = kljucZa(ctx.tenantId, 'objave', novi(), a.mime);
      const p = await noviPrijenos(env, ctx, 'gore', kljuc, a.mime, MAX_BAJTOVA);
      return { kljuc, url: p.url, istice: p.istice, max_bajtova: MAX_BAJTOVA, naredba: `curl -sf -X PUT -H "content-type: ${a.mime}" --data-binary @DATOTEKA "${p.url}"` };
    },
  },
  {
    name: 'predlozi_plan_tjedna',
    description: 'Tjedni plan objava za vlasnika (status "ceka"). Jedan plan po tjednu: ako plan tog tjedna još nije odobren, ovaj ga zamjenjuje. `sazetak`: brojke prošlog tjedna i što iz njih slijedi, objave tjedna po danima, popis kadrova koje Tina treba snimiti. Bez Markdown naslova (##).',
    inputSchema: s({
      tjedan: { type: 'string', pattern: ISO_TJEDAN.source }, naslov: { type: 'string' }, sazetak: { type: 'string' },
    }, ['tjedan', 'naslov', 'sazetak']),
    run: async (a, ctx, env) => {
      if (!ISO_TJEDAN.test(a.tjedan || '')) throw new Error('tjedan mora biti GGGG-Www, npr. 2026-W50');
      const naslov = tekst(a.naslov, 'naslov', 200, true).trim();
      const sazetak = tekst(a.sazetak, 'sazetak', 12000, true).trim();
      const stari = await jedan(env, `SELECT * FROM planovi_objava WHERE tenant_id = ? AND tjedan = ?`, ctx.tenantId, a.tjedan);
      const kad = sada();
      if (stari) {
        if (stari.status === 'odobreno') throw new Error('Plan tog tjedna je već odobren. Nove objave dodaj s predlozi_objavu.');
        await env.DB.batch([
          env.DB.prepare(`UPDATE planovi_objava SET naslov = ?, sazetak = ?, status = 'ceka', azurirano = ?, version = version + 1
                          WHERE tenant_id = ? AND id = ? AND version = ?`).bind(naslov, sazetak, kad, ctx.tenantId, stari.id, stari.version),
          nadzor(env, ctx, 'predlozi_plan_tjedna', 'planovi_objava', stari.id, { status: stari.status, naslov: stari.naslov }, { status: 'ceka', naslov }),
          aktivnost(env, ctx, `Ispravljen plan objava ${a.tjedan}: ${naslov}`),
        ]);
        return { id: stari.id, tjedan: a.tjedan, status: 'ceka', zamijenjen: true };
      }
      const id = novi();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO planovi_objava (id, tenant_id, tjedan, naslov, sazetak, status, kreirano, azurirano) VALUES (?, ?, ?, ?, ?, 'ceka', ?, ?)`)
          .bind(id, ctx.tenantId, a.tjedan, naslov, sazetak, kad, kad),
        nadzor(env, ctx, 'predlozi_plan_tjedna', 'planovi_objava', id, null, { tjedan: a.tjedan, naslov }),
        aktivnost(env, ctx, `Plan objava ${a.tjedan} čeka odobrenje: ${naslov}`),
      ]);
      return { id, tjedan: a.tjedan, status: 'ceka' };
    },
  },
  {
    name: 'predlozi_objavu',
    description: 'Gotova objava za odobrenje (status "ceka"). Mediji moraju biti već učitani (zatrazi_ucitavanje). Video: jedna MP4 datoteka 1080×1920. Slajdovi: JPEG, PNG ili WebP redom. Materijal iz knjižnice smije samo ako je slobodan. Ništa ne ide van dok vlasnik ne odobri.',
    inputSchema: s(objavaSchema, ['serija', 'vrsta', 'naslov', 'opis', 'mediji']),
    run: async (a, ctx, env) => {
      trebaR2(env);
      const kanal = a.kanal ?? 'tiktok';
      if (!KANALI.includes(kanal)) throw new Error(`kanal: ${KANALI.join(', ')}`);
      if (!SERIJE.includes(a.serija)) throw new Error(`serija: ${SERIJE.join(', ')}`);
      if (!['video', 'slajdovi'].includes(a.vrsta)) throw new Error('vrsta: video ili slajdovi');
      const naslov = tekst(a.naslov, 'naslov', 200, true).trim();
      const opis = tekst(a.opis, 'opis', MAX_OPIS, true).trim();
      const scenarij = tekst(a.scenarij, 'scenarij', 8000);
      const termin = provjeriTermin(a.termin);
      const { n } = await jedan(env, `SELECT COUNT(*) AS n FROM objave WHERE tenant_id = ? AND kreirano >= ?`,
        ctx.tenantId, new Date(Date.now() - 7 * 24 * SAT).toISOString());
      if (n >= MAX_OBJAVA_TJEDNO) throw new Error(`Ograničenje: najviše ${MAX_OBJAVA_TJEDNO} novih objava u 7 dana`);
      const mediji = await provjeriMedije(env, ctx, a.vrsta, a.mediji);
      const knjiznica = await provjeriKnjiznicu(env, ctx, a.knjiznica);
      let planId = null;
      if (a.tjedan) {
        if (!ISO_TJEDAN.test(a.tjedan)) throw new Error('tjedan mora biti GGGG-Www');
        planId = (await jedan(env, `SELECT id FROM planovi_objava WHERE tenant_id = ? AND tjedan = ?`, ctx.tenantId, a.tjedan))?.id ?? null;
        if (!planId) throw new Error(`Plan za ${a.tjedan} ne postoji. Prvo predlozi_plan_tjedna.`);
      }
      const id = novi(), kad = sada();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO objave (id, tenant_id, plan_id, kanal, serija, vrsta, naslov, opis, scenarij, termin, mediji_json, knjiznica_json, ai_oznaka, status, kreirano, azurirano)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ceka', ?, ?)`,
        ).bind(id, ctx.tenantId, planId, kanal, a.serija, a.vrsta, naslov, opis, scenarij, termin,
          JSON.stringify(mediji), JSON.stringify(knjiznica), a.ai_oznaka ? 1 : 0, kad, kad),
        nadzor(env, ctx, 'predlozi_objavu', 'objave', id, null, { kanal, serija: a.serija, vrsta: a.vrsta, naslov, mediji: mediji.length }),
        aktivnost(env, ctx, `Objava čeka odobrenje: ${naslov}`),
      ]);
      return { id, status: 'ceka', mediji: mediji.length };
    },
  },
  {
    name: 'azuriraj_objavu',
    description: 'Ispravi objavu koja čeka ili koju je vlasnik vratio s komentarom. Pošalji samo polja koja mijenjaš. Objava se vraća u "ceka" za ponovno odobrenje; komentar vlasnika ostaje vidljiv uz nju.',
    inputSchema: s({ id: { type: 'string' }, ...objavaSchema }, ['id']),
    run: async (a, ctx, env) => {
      const o = await jedan(env, `SELECT * FROM objave WHERE tenant_id = ? AND id = ?`, ctx.tenantId, a.id);
      if (!o) throw new Error('Objava ne postoji');
      if (!['ceka', 'vraceno'].includes(o.status)) throw new Error(`Objava se ne može mijenjati (status: ${o.status})`);
      const vrsta = a.vrsta ?? o.vrsta;
      if (a.vrsta != null && !['video', 'slajdovi'].includes(a.vrsta)) throw new Error('vrsta: video ili slajdovi');
      if (a.vrsta != null && a.vrsta !== o.vrsta && a.mediji == null) throw new Error('Kad mijenjaš vrstu, pošalji i nove medije');
      if (a.kanal != null && !KANALI.includes(a.kanal)) throw new Error(`kanal: ${KANALI.join(', ')}`);
      if (a.serija != null && !SERIJE.includes(a.serija)) throw new Error(`serija: ${SERIJE.join(', ')}`);
      const n = {
        kanal: a.kanal ?? o.kanal, serija: a.serija ?? o.serija, vrsta,
        naslov: a.naslov != null ? tekst(a.naslov, 'naslov', 200, true).trim() : o.naslov,
        opis: a.opis != null ? tekst(a.opis, 'opis', MAX_OPIS, true).trim() : o.opis,
        scenarij: a.scenarij != null ? tekst(a.scenarij, 'scenarij', 8000) : o.scenarij,
        termin: a.termin != null ? provjeriTermin(a.termin) : o.termin,
        mediji_json: a.mediji != null ? JSON.stringify(await (trebaR2(env), provjeriMedije(env, ctx, vrsta, a.mediji))) : o.mediji_json,
        knjiznica_json: a.knjiznica != null ? JSON.stringify(await provjeriKnjiznicu(env, ctx, a.knjiznica)) : o.knjiznica_json,
        ai_oznaka: a.ai_oznaka != null ? (a.ai_oznaka ? 1 : 0) : o.ai_oznaka,
      };
      const kad = sada();
      const upd = await env.DB.prepare(
        `UPDATE objave SET kanal = ?, serija = ?, vrsta = ?, naslov = ?, opis = ?, scenarij = ?, termin = ?, mediji_json = ?, knjiznica_json = ?,
           ai_oznaka = ?, status = 'ceka', izmjena = izmjena + 1, azurirano = ?, version = version + 1
         WHERE tenant_id = ? AND id = ? AND version = ?`,
      ).bind(n.kanal, n.serija, n.vrsta, n.naslov, n.opis, n.scenarij, n.termin, n.mediji_json, n.knjiznica_json, n.ai_oznaka, kad,
        ctx.tenantId, a.id, o.version).run();
      if (!upd.meta.changes) throw new Error('Objava je u međuvremenu promijenjena, dohvati je ponovno');
      await env.DB.batch([
        nadzor(env, ctx, 'azuriraj_objavu', 'objave', a.id, { status: o.status, izmjena: o.izmjena }, { status: 'ceka', izmjena: o.izmjena + 1 }),
        aktivnost(env, ctx, `Ispravljena objava čeka odobrenje: ${n.naslov}`),
      ]);
      return { id: a.id, status: 'ceka', izmjena: o.izmjena + 1 };
    },
  },
  {
    name: 'dohvati_objave',
    description: 'Planovi i objave s ploče: status (ceka, odobreno, vraceno, odbaceno, objavljeno) i komentar vlasnika. Na početku svake sesije: što je vraćeno (ispraviti), što je odobreno i objavljeno.',
    inputSchema: s({
      status: { type: 'string', enum: ['ceka', 'odobreno', 'vraceno', 'odbaceno', 'objavljeno'] },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 40 },
    }),
    run: async (a, ctx, env) => {
      const lim = Math.min(Math.max(parseInt(a.limit ?? 40, 10) || 40, 1), 100);
      const [planovi, objave] = await Promise.all([
        sve(env, `SELECT * FROM planovi_objava WHERE tenant_id = ? ORDER BY tjedan DESC LIMIT 6`, ctx.tenantId),
        a.status
          ? sve(env, `SELECT * FROM objave WHERE tenant_id = ? AND status = ? ORDER BY azurirano DESC LIMIT ?`, ctx.tenantId, a.status, lim)
          : sve(env, `SELECT * FROM objave WHERE tenant_id = ? ORDER BY azurirano DESC LIMIT ?`, ctx.tenantId, lim),
      ]);
      return { planovi: planovi.map(planDokument), objave: objave.map(objavaDokument) };
    },
  },
  {
    name: 'dohvati_knjiznicu',
    description: 'Materijal iz knjižnice koji SMIJE u objavu (vlasnik ga je označio kao slobodan): fotografije i sirove snimke s opisom. Ostali materijal se ne vraća. Datoteku preuzmi sa zatrazi_preuzimanje.',
    inputSchema: s({ usluga: { type: 'string', enum: USLUGE }, vrsta: { type: 'string', enum: ['foto', 'video'] } }),
    run: async (a, ctx, env) => {
      const uvjeti = ['tenant_id = ?', 'slobodno = 1'], args = [ctx.tenantId];
      if (a.usluga) { uvjeti.push('(usluga = ? OR usluga = \'oboje\')'); args.push(a.usluga); }
      if (a.vrsta) { uvjeti.push('vrsta = ?'); args.push(a.vrsta); }
      const [stavke, ostalo] = await Promise.all([
        sve(env, `SELECT * FROM knjiznica WHERE ${uvjeti.join(' AND ')} ORDER BY kreirano DESC LIMIT 200`, ...args),
        jedan(env, `SELECT COUNT(*) AS n FROM knjiznica WHERE tenant_id = ? AND slobodno = 0`, ctx.tenantId),
      ]);
      return { stavke: stavke.map(knjiznicaDokument), nije_slobodno: ostalo.n };
    },
  },
  {
    name: 'zatrazi_preuzimanje',
    description: 'Adresa (vrijedi 2 sata) za preuzimanje datoteke: materijala iz knjižnice (samo slobodnog) po `knjiznica_id`, ili medija postojeće objave po `kljuc`. Preuzmi s: curl -sf -o datoteka "<url>".',
    inputSchema: s({ knjiznica_id: { type: 'string' }, kljuc: { type: 'string' } }),
    run: async (a, ctx, env) => {
      trebaR2(env);
      let kljuc, mime;
      if (a.knjiznica_id) {
        const k = await jedan(env, `SELECT kljuc, mime, slobodno FROM knjiznica WHERE tenant_id = ? AND id = ?`, ctx.tenantId, a.knjiznica_id);
        if (!k) throw new Error('Materijal ne postoji');
        if (!k.slobodno) throw new Error('Materijal nije označen kao slobodan za objavu');
        ({ kljuc, mime } = k);
      } else if (a.kljuc) {
        if (!pripadaZakupcu(ctx.tenantId, a.kljuc) || !a.kljuc.startsWith(`${ctx.tenantId}/objave/`)) throw new Error('Neispravan ključ');
        kljuc = a.kljuc;
      } else throw new Error('Pošalji knjiznica_id ili kljuc');
      const p = await noviPrijenos(env, ctx, 'dolje', kljuc, mime ?? null, null);
      return { url: p.url, istice: p.istice };
    },
  },
];

/** PUT /ucitaj/<token> i GET /preuzmi/<token>: jedini put kojim Claude piše u R2 i čita iz njega. */
export async function prijenos(request, env, smjer, token) {
  if (!env.MEDIJI) return new Response('Spremište nije spojeno', { status: 503 });
  const red = await env.DB.prepare(`SELECT * FROM prijenosi WHERE hash = ? AND smjer = ?`).bind(await sha256Hex(token), smjer).first();
  if (!red || red.istice < sada()) return new Response('Adresa ne vrijedi ili je istekla', { status: 404 });

  if (smjer === 'dolje') {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
    return posluziObjekt(env.MEDIJI, red.kljuc, request);
  }

  if (request.method !== 'PUT') return new Response('Method not allowed', { status: 405, headers: { allow: 'PUT' } });
  if (red.iskoristeno) return new Response('Adresa je već iskorištena', { status: 409 });
  const mime = (request.headers.get('content-type') || '').split(';')[0].trim();
  if (mime !== red.mime) return new Response(`Očekivan content-type: ${red.mime}`, { status: 415 });
  const duljina = Number(request.headers.get('content-length'));
  if (!Number.isFinite(duljina) || duljina <= 0) return new Response('Nedostaje content-length', { status: 411 });
  if (duljina > red.max_bajtova) return new Response(`Datoteka je veća od ${Math.round(red.max_bajtova / 1048576)} MB`, { status: 413 });
  const upd = await env.DB.prepare(`UPDATE prijenosi SET iskoristeno = ? WHERE hash = ? AND iskoristeno IS NULL`).bind(sada(), red.hash).run();
  if (!upd.meta.changes) return new Response('Adresa je već iskorištena', { status: 409 });
  const obj = await env.MEDIJI.put(red.kljuc, request.body, { httpMetadata: { contentType: mime } });
  return new Response(JSON.stringify({ ok: true, kljuc: red.kljuc, velicina: obj.size }), { status: 201, headers: { 'content-type': 'application/json' } });
}
