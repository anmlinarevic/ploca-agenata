/* Zajedničko za objave (dashboard i MCP): dopuštene vrste datoteka, R2 ključevi i oblik zapisa za ploču. */

// Vrste koje smiju u R2. iPhone snima .mov (video/quicktime); Claude ga prije objave pretvara u MP4.
export const MIME = {
  'video/mp4': { ext: 'mp4', vrsta: 'video' },
  'video/quicktime': { ext: 'mov', vrsta: 'video' },
  'image/jpeg': { ext: 'jpg', vrsta: 'foto' },
  'image/png': { ext: 'png', vrsta: 'foto' },
  'image/webp': { ext: 'webp', vrsta: 'foto' },
  'image/heic': { ext: 'heic', vrsta: 'foto' },
};
// Cloudflare na Free i Pro planu prima tijelo zahtjeva do 100 MB.
export const MAX_BAJTOVA = 95 * 1024 * 1024;
export const KANALI = ['tiktok', 'instagram', 'facebook'];
export const SERIJE = ['imena', 'iza-sava', 'proslave', 'igraonica', 'ostalo'];
export const USLUGE = ['banneri', 'igraonica', 'oboje'];
export const ISO_TJEDAN = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
export const MAX_OPIS = 2200;

export const kljucZa = (tenant, mapa, id, mime) =>
  `${tenant}/${mapa}/${new Date().toISOString().slice(0, 7)}/${id}.${MIME[mime].ext}`;

/** Ključ smije čitati samo njegov zakupac; bez „..” i čudnih znakova. */
export const pripadaZakupcu = (tenant, kljuc) =>
  typeof kljuc === 'string' && kljuc.startsWith(`${tenant}/`) && !kljuc.includes('..') && /^[\w./-]{3,200}$/.test(kljuc);

export const parseJson = (s, zadano) => { try { return s == null ? zadano : JSON.parse(s); } catch { return zadano; } };

export const planDokument = (p) => ({
  id: p.id, tjedan: p.tjedan, naslov: p.naslov, sazetak: p.sazetak, status: p.status, komentar: p.komentar,
  odlucenoAt: p.odluceno_at, kreirano: p.kreirano, azurirano: p.azurirano, version: p.version,
});

export const objavaDokument = (o) => ({
  id: o.id, planId: o.plan_id, kanal: o.kanal, racunId: o.racun_id ?? null, grupaId: o.grupa_id ?? null, serija: o.serija, vrsta: o.vrsta, naslov: o.naslov, opis: o.opis,
  scenarij: o.scenarij, termin: o.termin, mediji: parseJson(o.mediji_json, []), knjiznica: parseJson(o.knjiznica_json, []),
  aiOznaka: !!o.ai_oznaka, status: o.status, komentar: o.komentar, odlucenoAt: o.odluceno_at, objavljenoAt: o.objavljeno_at,
  poveznica: o.poveznica, izmjena: o.izmjena, kreirano: o.kreirano, azurirano: o.azurirano, version: o.version,
});

export const knjiznicaDokument = (k) => ({
  id: k.id, kljuc: k.kljuc, naziv: k.naziv, vrsta: k.vrsta, mime: k.mime, velicina: k.velicina, usluga: k.usluga,
  opis: k.opis, imaDjece: !!k.ima_djece, pristanak: !!k.pristanak, slobodno: !!k.slobodno, kreirano: k.kreirano,
});

/** Range zaglavlje → opcije za R2 get (jedan raspon). */
export function rasponIzZaglavlja(h) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h || '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') return { suffix: +m[2] };
  const offset = +m[1];
  return m[2] === '' ? { offset } : { offset, length: +m[2] - offset + 1 };
}

/** Odgovor s R2 objektom (cijeli ili dio za premotavanje videa). */
export async function posluziObjekt(bucket, kljuc, request, { preuzmi = null } = {}) {
  const raspon = rasponIzZaglavlja(request.headers.get('range'));
  const obj = await bucket.get(kljuc, raspon ? { range: raspon } : undefined);
  if (!obj) return new Response('Datoteka ne postoji', { status: 404 });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  h.set('accept-ranges', 'bytes');
  h.set('cache-control', 'private, max-age=3600');
  h.set('x-content-type-options', 'nosniff');
  if (preuzmi) h.set('content-disposition', `attachment; filename="${preuzmi.replace(/[^\w.-]/g, '_')}"`);
  if (raspon && obj.range) {
    // R2 vraća sva tri polja (offset, length, suffix), neka kao undefined.
    const sufiks = obj.range.suffix != null;
    const off = sufiks ? obj.size - obj.range.suffix : (obj.range.offset ?? 0);
    const len = sufiks ? obj.range.suffix : (obj.range.length ?? obj.size - off);
    h.set('content-range', `bytes ${off}-${off + len - 1}/${obj.size}`);
    h.set('content-length', String(len));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set('content-length', String(obj.size));
  return new Response(obj.body, { headers: h });
}
