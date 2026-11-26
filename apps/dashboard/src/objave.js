/* Objave i knjižnica materijala na ploči. Claude objave predlaže preko MCP-a; ovdje ih čovjek odobrava,
 * vraća s komentarom, odbacuje i označava kao objavljene. Knjižnicu puni čovjek (učitavanje s mobitela). */
import {
  MIME, MAX_BAJTOVA, USLUGE, kljucZa, pripadaZakupcu, planDokument, objavaDokument, knjiznicaDokument, posluziObjekt,
} from '../../../packages/poslovanje/objave.js';

const all = async (env, sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
const one = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).first();
const da = (v) => v === true || v === 1 || v === '1' || v === 'true';

function komentarIz(body, obavezan) {
  const k = body.komentar == null ? '' : body.komentar;
  if (typeof k !== 'string' || k.length > 2000) throw new Error('komentar: najviše 2000 znakova');
  if (obavezan && k.trim().length < 3) throw new Error('Napiši što treba promijeniti');
  return k.trim() || null;
}
function oznakeKnjiznice(x) {
  const usluga = x.usluga ?? 'banneri';
  if (!USLUGE.includes(usluga)) throw new Error(`usluga: ${USLUGE.join(', ')}`);
  const opis = x.opis == null || x.opis === '' ? null : String(x.opis);
  if (opis && opis.length > 500) throw new Error('opis: najviše 500 znakova');
  const imaDjece = da(x.imaDjece ?? x.djeca), pristanak = da(x.pristanak), slobodno = da(x.slobodno);
  if (imaDjece && !pristanak && slobodno) throw new Error('Snimka s djetetom bez pristanka roditelja ne smije u objavu.');
  return { usluga, opis, ima_djece: imaDjece ? 1 : 0, pristanak: pristanak ? 1 : 0, slobodno: slobodno ? 1 : 0 };
}

/** GET /api/mediji/<ključ>: videi i slike za pregled na ploči (samo vlastiti zakupac). `?preuzmi=ime` za preuzimanje. */
export async function posluziMedij(request, env, tenant, url) {
  if (!env.MEDIJI) return new Response('Spremište medija nije spojeno', { status: 503 });
  const kljuc = decodeURIComponent(url.pathname.slice('/api/mediji/'.length));
  if (!pripadaZakupcu(tenant, kljuc)) return new Response('Nema pristupa', { status: 404 });
  return posluziObjekt(env.MEDIJI, kljuc, request, { preuzmi: url.searchParams.get('preuzmi') });
}

/** PUT /api/knjiznica/datoteka?usluga=&opis=&djeca=&pristanak=&slobodno=&naziv= — tijelo je sama datoteka. */
export async function ucitajUKnjiznicu(request, env, u, tenant, url, h) {
  const { json, greska, audit, dnevnik, novi, sada } = h;
  if (!env.MEDIJI) return greska('Spremište medija nije spojeno', 503);
  const mime = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!MIME[mime]) return greska('Dopušteni su MP4, MOV, JPEG, PNG, WebP i HEIC.', 415);
  const duljina = Number(request.headers.get('content-length'));
  if (!Number.isFinite(duljina) || duljina <= 0) return greska('Prazna datoteka', 411);
  if (duljina > MAX_BAJTOVA) return greska('Datoteka je veća od 95 MB. Snimaj u 1080p ili skrati snimku.', 413);
  const q = Object.fromEntries(url.searchParams);
  const o = oznakeKnjiznice(q);
  const naziv = (q.naziv || '').slice(0, 200) || null;
  const id = novi();
  const kljuc = kljucZa(tenant, 'knjiznica', id, mime);
  const obj = await env.MEDIJI.put(kljuc, request.body, { httpMetadata: { contentType: mime } });
  const red = { id, kljuc, naziv, vrsta: MIME[mime].vrsta, mime, velicina: obj.size, ...o };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO knjiznica (id, tenant_id, kljuc, naziv, vrsta, mime, velicina, usluga, opis, ima_djece, pristanak, slobodno, ucitao, kreirano)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, tenant, kljuc, naziv, red.vrsta, mime, obj.size, o.usluga, o.opis, o.ima_djece, o.pristanak, o.slobodno, u.id, sada()),
    audit(env, u, tenant, 'knjiznica_ucitano', 'knjiznica', id, null, red),
    dnevnik(env, tenant, `U knjižnicu: ${o.opis || naziv || red.vrsta}${o.slobodno ? '' : ' (nije za objavu)'}`),
  ]);
  return json({ id, kljuc, velicina: obj.size });
}

export async function apiObjave(request, env, u, tenant, putanja, body, h) {
  const { json, greska, audit, dnevnik, sada } = h;
  const m = request.method;
  let r;

  if (m === 'GET' && putanja === '/api/objave') {
    const prije = new Date(Date.now() - 45 * 864e5).toISOString();
    const [planovi, objave, knj] = await Promise.all([
      all(env, `SELECT * FROM planovi_objava WHERE tenant_id = ? ORDER BY tjedan DESC LIMIT 8`, tenant),
      all(env, `SELECT * FROM objave WHERE tenant_id = ? AND (status IN ('ceka', 'vraceno', 'odobreno') OR azurirano >= ?)
                ORDER BY COALESCE(termin, kreirano) LIMIT 200`, tenant, prije),
      one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(slobodno), 0) AS slobodno FROM knjiznica WHERE tenant_id = ?`, tenant),
    ]);
    return json({ planovi: planovi.map(planDokument), objave: objave.map(objavaDokument), knjiznica: { ukupno: knj.n, slobodno: knj.slobodno } });
  }

  // Odobri, vrati s komentarom ili odbaci objavu koja čeka.
  if (m === 'POST' && (r = /^\/api\/objave\/([\w-]+)\/odluka$/.exec(putanja))) {
    if (!['odobreno', 'vraceno', 'odbaceno'].includes(body.status)) return greska('status mora biti odobreno, vraceno ili odbaceno');
    const o = await one(env, `SELECT status, naslov, version FROM objave WHERE tenant_id = ? AND id = ?`, tenant, r[1]);
    if (!o) return greska('Objava ne postoji', 404);
    if (o.status !== 'ceka') return greska('Objava je već riješena', 409);
    if (body.version != null && body.version !== o.version) return greska('Claude je u međuvremenu promijenio objavu. Osvježi i pogledaj je ponovno.', 409);
    const komentar = komentarIz(body, body.status === 'vraceno');
    const upd = await env.DB.prepare(
      `UPDATE objave SET status = ?, komentar = COALESCE(?, komentar), odluceno_at = ?, odlucio_user_id = ?, azurirano = ?, version = version + 1
       WHERE tenant_id = ? AND id = ? AND status = 'ceka' AND version = ?`,
    ).bind(body.status, komentar, sada(), u.id, sada(), tenant, r[1], o.version).run();
    if (!upd.meta.changes) return greska('Objava je u međuvremenu promijenjena. Osvježi stranicu.', 409);
    const rijec = { odobreno: 'Odobrena objava', vraceno: 'Vraćena objava', odbaceno: 'Odbačena objava' }[body.status];
    await env.DB.batch([
      audit(env, u, tenant, `objava_${body.status}`, 'objave', r[1], { status: 'ceka' }, { status: body.status, komentar }),
      dnevnik(env, tenant, `${rijec}: ${o.naslov}`),
    ]);
    return json({ ok: true });
  }

  // Čovjek je objavio odobrenu objavu (dok ploča nema vezu s TikTokom).
  if (m === 'POST' && (r = /^\/api\/objave\/([\w-]+)\/objavljeno$/.exec(putanja))) {
    const o = await one(env, `SELECT status, naslov FROM objave WHERE tenant_id = ? AND id = ?`, tenant, r[1]);
    if (!o) return greska('Objava ne postoji', 404);
    if (o.status !== 'odobreno') return greska('Objaviti se može samo odobrena objava', 409);
    const pov = body.poveznica == null || body.poveznica === '' ? null : String(body.poveznica).trim();
    if (pov && (!/^https:\/\/[^\s]+$/.test(pov) || pov.length > 500)) return greska('Poveznica mora počinjati s https://');
    await env.DB.batch([
      env.DB.prepare(`UPDATE objave SET status = 'objavljeno', objavljeno_at = ?, poveznica = ?, azurirano = ?, version = version + 1
                      WHERE tenant_id = ? AND id = ? AND status = 'odobreno'`).bind(sada(), pov, sada(), tenant, r[1]),
      audit(env, u, tenant, 'objava_objavljeno', 'objave', r[1], { status: 'odobreno' }, { status: 'objavljeno', poveznica: pov }),
      dnevnik(env, tenant, `Objavljeno: ${o.naslov}`),
    ]);
    return json({ ok: true });
  }

  // Tjedni plan: odobri ili vrati s komentarom.
  if (m === 'POST' && (r = /^\/api\/planovi-objava\/([\w-]+)\/odluka$/.exec(putanja))) {
    if (!['odobreno', 'vraceno'].includes(body.status)) return greska('status mora biti odobreno ili vraceno');
    const p = await one(env, `SELECT status, tjedan, version FROM planovi_objava WHERE tenant_id = ? AND id = ?`, tenant, r[1]);
    if (!p) return greska('Plan ne postoji', 404);
    if (p.status !== 'ceka') return greska('Plan je već riješen', 409);
    const komentar = komentarIz(body, body.status === 'vraceno');
    const upd = await env.DB.prepare(
      `UPDATE planovi_objava SET status = ?, komentar = COALESCE(?, komentar), odluceno_at = ?, odlucio_user_id = ?, azurirano = ?, version = version + 1
       WHERE tenant_id = ? AND id = ? AND status = 'ceka' AND version = ?`,
    ).bind(body.status, komentar, sada(), u.id, sada(), tenant, r[1], p.version).run();
    if (!upd.meta.changes) return greska('Plan je u međuvremenu promijenjen. Osvježi stranicu.', 409);
    await env.DB.batch([
      audit(env, u, tenant, `plan_objava_${body.status}`, 'planovi_objava', r[1], { status: 'ceka' }, { status: body.status, komentar }),
      dnevnik(env, tenant, `${body.status === 'odobreno' ? 'Odobren' : 'Vraćen'} plan objava ${p.tjedan}`),
    ]);
    return json({ ok: true });
  }

  // Knjižnica: popis, oznake, brisanje.
  if (m === 'GET' && putanja === '/api/knjiznica') {
    const stavke = await all(env, `SELECT * FROM knjiznica WHERE tenant_id = ? ORDER BY kreirano DESC LIMIT 300`, tenant);
    return json({ stavke: stavke.map(knjiznicaDokument) });
  }
  if (m === 'POST' && (r = /^\/api\/knjiznica\/([\w-]+)$/.exec(putanja))) {
    const k = await one(env, `SELECT * FROM knjiznica WHERE tenant_id = ? AND id = ?`, tenant, r[1]);
    if (!k) return greska('Materijal ne postoji', 404);
    const o = oznakeKnjiznice({
      usluga: body.usluga ?? k.usluga, opis: body.opis !== undefined ? body.opis : k.opis,
      imaDjece: body.imaDjece ?? !!k.ima_djece, pristanak: body.pristanak ?? !!k.pristanak, slobodno: body.slobodno ?? !!k.slobodno,
    });
    await env.DB.batch([
      env.DB.prepare(`UPDATE knjiznica SET usluga = ?, opis = ?, ima_djece = ?, pristanak = ?, slobodno = ? WHERE tenant_id = ? AND id = ?`)
        .bind(o.usluga, o.opis, o.ima_djece, o.pristanak, o.slobodno, tenant, r[1]),
      audit(env, u, tenant, 'knjiznica_oznake', 'knjiznica', r[1],
        { usluga: k.usluga, opis: k.opis, ima_djece: k.ima_djece, pristanak: k.pristanak, slobodno: k.slobodno }, o),
    ]);
    return json({ ok: true });
  }
  if (m === 'POST' && (r = /^\/api\/knjiznica\/([\w-]+)\/obrisi$/.exec(putanja))) {
    const k = await one(env, `SELECT * FROM knjiznica WHERE tenant_id = ? AND id = ?`, tenant, r[1]);
    if (!k) return greska('Materijal ne postoji', 404);
    if (env.MEDIJI) await env.MEDIJI.delete(k.kljuc);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM knjiznica WHERE tenant_id = ? AND id = ?`).bind(tenant, r[1]),
      audit(env, u, tenant, 'knjiznica_obrisano', 'knjiznica', r[1], knjiznicaDokument(k), null),
    ]);
    return json({ ok: true });
  }

  return null;
}
