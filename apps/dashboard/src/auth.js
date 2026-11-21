/* Prijava: Cloudflare Access šalje potpisan JWT u zaglavlju Cf-Access-Jwt-Assertion.
 * Provjeravamo potpis (RS256, ključevi s /cdn-cgi/access/certs), aud, iss i exp,
 * pa e-mail mapiramo na red u `users`. Fail-closed: bez postavki nema pristupa.
 * Lokalni razvoj: DEV_USER (samo u .dev.vars, nikad u wrangler.jsonc ni u produkciji). */

let cacheKljuceva = { kad: 0, kljucevi: [] };

const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const b64uJson = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));

async function kljucevi(tim) {
  if (Date.now() - cacheKljuceva.kad < 10 * 60 * 1000 && cacheKljuceva.kljucevi.length) return cacheKljuceva.kljucevi;
  const r = await fetch(`https://${tim}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('Access ključevi nisu dostupni');
  const { keys } = await r.json();
  cacheKljuceva = { kad: Date.now(), kljucevi: keys };
  return keys;
}

export async function provjeriJwt(jwt, env) {
  const [h, p, sig] = (jwt || '').split('.');
  if (!h || !p || !sig) return null;
  const header = b64uJson(h), payload = b64uJson(p);
  if (header.alg !== 'RS256') return null;
  const jwk = (await kljucevi(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const kljuc = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', kljuc, b64u(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const aud = [].concat(payload.aud || []);
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  return payload.email ? { email: String(payload.email).toLowerCase() } : null;
}

/** Vraća {id, email, uloga, tenant_id} ili {greska: Response}. */
export async function korisnik(request, env) {
  let email = null;
  if (env.DEV_USER) {
    // DEV_USER='*' (samo lokalni testovi): e-mail dolazi iz zaglavlja x-dev-user.
    email = (env.DEV_USER === '*' ? request.headers.get('x-dev-user') || '' : env.DEV_USER).toLowerCase() || null;
  } else if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    try { email = (await provjeriJwt(request.headers.get('cf-access-jwt-assertion'), env))?.email ?? null; } catch { email = null; }
  } else {
    return { greska: new Response('Prijava nije podešena (ACCESS_TEAM_DOMAIN / ACCESS_AUD).', { status: 500 }) };
  }
  if (!email) return { greska: new Response('Nisi prijavljen.', { status: 401 }) };
  const u = await env.DB.prepare(`SELECT id, email, uloga, tenant_id FROM users WHERE lower(email) = ?`).bind(email).first();
  if (!u) return { greska: new Response('Tvoj e-mail nema pristup ovoj ploči.', { status: 403 }) };
  return u;
}
