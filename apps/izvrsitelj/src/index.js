/* Izvršitelj agenata. Nema javnu adresu: dashboard ga zove preko service bindinga (uz zajednički ključ),
 * a Cron ga budi ponedjeljkom. Posao ide u Queue (jedan po jedan), rezultat i trošak u D1.
 * Piše samo u `pokretanja`, `zadaci` (status izvođenja) i `audit_log`; sve ostalo agent radi kroz MCP. */
import { AGENTI, TJEDNI_LANAC } from '../../../packages/agenti/index.js';
import { pokreniAgenta } from './agent.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const sada = () => new Date().toISOString();
const novi = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const prvi = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;

const jedan = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).first();
const nadzor = (env, tenant, akcija, entitet, id, poslije) =>
  env.DB.prepare(`INSERT INTO audit_log (tenant_id, kad, akter, akcija, entitet, entitet_id, poslije_json) VALUES (?, ?, 'izvrsitelj', ?, ?, ?, ?)`)
    .bind(tenant, sada(), akcija, entitet, id, JSON.stringify(poslije));

async function postavke(env, tenant) {
  const t = await jedan(env, `SELECT naziv, postavke_json FROM tenants WHERE id = ?`, tenant);
  if (!t) return null;
  const p = parse(t.postavke_json) || {};
  return { naziv: t.naziv, limitUsd: Number.isFinite(+p.limit_usd) ? +p.limit_usd : 20, raspored: p.raspored === true };
}

async function potroseno(env, tenant) {
  const r = await jedan(env, `SELECT COALESCE(SUM(trosak_usd), 0) AS s FROM pokretanja WHERE tenant_id = ? AND kreirano >= ?`, tenant, prvi(new Date()));
  return r.s;
}

/** Stvara red u `pokretanja` i stavlja ga u Queue. `lanac` = agenti koji slijede nakon ovoga. */
async function stavi(env, { tenant, agent, vrsta, opis, zadatakId = null, lanac = [] }) {
  const id = novi();
  await env.DB.prepare(
    `INSERT INTO pokretanja (id, tenant_id, zadatak_id, agent, status, kreirano, vrsta, opis, zatim) VALUES (?, ?, ?, ?, 'u_redu', ?, ?, ?, ?)`,
  ).bind(id, tenant, zadatakId, agent, sada(), vrsta, opis, lanac.join(',') || null).run();
  await env.RED.send({ pokretanje_id: id, tenant_id: tenant });
  return id;
}

async function zatvoriZadatak(env, tenant, zadatakId, status, rezultat) {
  if (!zadatakId) return;
  await env.DB.batch([
    env.DB.prepare(`UPDATE zadaci SET status = ?, rezultat = ?, version = version + 1 WHERE tenant_id = ? AND id = ?`)
      .bind(status, (rezultat || '').slice(0, 1000), tenant, zadatakId),
    nadzor(env, tenant, 'zadatak_izvrsen', 'zadaci', zadatakId, { status }),
  ]);
}

async function obradi(env, { pokretanje_id: id, tenant_id: tenant }) {
  const p = await jedan(env, `SELECT * FROM pokretanja WHERE tenant_id = ? AND id = ?`, tenant, id);
  if (!p || p.status !== 'u_redu') return; // ponovna isporuka poruke ne smije dvaput trošiti
  await env.DB.prepare(`UPDATE pokretanja SET status = 'radi', pocetak = ? WHERE tenant_id = ? AND id = ?`).bind(sada(), tenant, id).run();

  const kraj = async (status, rezultat, greska, ostalo = {}) => {
    const z = ostalo.zbroj;
    await env.DB.prepare(
      `UPDATE pokretanja SET status = ?, kraj = ?, rezultat = ?, greska = ?, model = ?, koraka = ?, pretrage = ?, tokeni_ulaz = ?,
         tokeni_izlaz = ?, tokeni_cache_citanje = ?, tokeni_cache_pisanje = ?, trosak_usd = ? WHERE tenant_id = ? AND id = ?`,
    ).bind(status, sada(), rezultat ?? null, greska ?? null, ostalo.model ?? null, ostalo.koraka ?? 0, z?.pretrage ?? 0, z?.ulaz ?? 0,
      z?.izlaz ?? 0, z?.cacheCitanje ?? 0, z?.cachePisanje ?? 0, ostalo.trosak ?? 0, tenant, id).run();
    if (p.zadatak_id) {
      if (status === 'uspjeh') await zatvoriZadatak(env, tenant, p.zadatak_id, 'gotovo', rezultat);
      else await zatvoriZadatak(env, tenant, p.zadatak_id, 'novo', `Pokretanje nije uspjelo: ${greska}`);
    }
  };

  try {
    const def = AGENTI[p.agent];
    const tokeni = parse(env.AGENT_TOKENS) || {};
    const token = tokeni[tenant]?.[p.agent];
    const post = await postavke(env, tenant);
    if (!def) return await kraj('greska', null, `Agent "${p.agent}" još nije dostupan u izvršitelju.`);
    if (!token) return await kraj('greska', null, `Nema tokena za agenta "${p.agent}" (secret AGENT_TOKENS).`);
    if (!post) return await kraj('greska', null, 'Zakupac ne postoji.');
    if (!env.ANTHROPIC_API_KEY) return await kraj('greska', null, 'ANTHROPIC_API_KEY nije postavljen.');

    const preostalo = post.limitUsd - (await potroseno(env, tenant));
    if (preostalo <= 0) return await kraj('odbijeno_limit', null, `Mjesečni limit potrošnje (${post.limitUsd} USD) je dosegnut.`);

    const danas = sada().slice(0, 10);
    const zadatak = p.zadatak_id
      ? (await jedan(env, `SELECT opis FROM zadaci WHERE tenant_id = ? AND id = ?`, tenant, p.zadatak_id))?.opis
      : p.opis;
    const r = await pokreniAgenta({ env, definicija: def, token, zadatak: `${zadatak}\n\n(Datum: ${danas}.)`, preostaloUsd: preostalo, danas, nazivZakupca: post.naziv });
    await kraj(r.status, r.rezultat, r.greska, r);

    // Lanac: sljedeći agent samo ako je ovaj uspio
    if (r.status === 'uspjeh' && p.zatim) {
      const [sljedeci, ...ostali] = p.zatim.split(',');
      await stavi(env, { tenant, agent: sljedeci, vrsta: p.vrsta, opis: p.opis, lanac: ostali });
    }
  } catch (e) {
    await kraj('greska', null, String(e.message || e).slice(0, 500));
  }
}

async function pokreniPregled(env, tenant, opis = 'Tjedni pregled') {
  const [prvi_, ...ostali] = TJEDNI_LANAC;
  return stavi(env, { tenant, agent: prvi_, vrsta: 'pregled', opis: `${opis}: tjedni`, lanac: ostali });
}

export default {
  // Samo dashboard (service binding) uz zajednički ključ.
  async fetch(request, env) {
    if (!env.INTERNI_KLJUC || request.headers.get('x-interni-kljuc') !== env.INTERNI_KLJUC) return new Response('Zabranjeno', { status: 403 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const url = new URL(request.url);
    const b = await request.json().catch(() => ({}));
    const tenant = String(b.tenant || '');
    if (!(await postavke(env, tenant))) return json({ greska: 'Zakupac ne postoji' }, 404);

    if (url.pathname === '/zadatak') {
      const z = await jedan(env, `SELECT id, agent, status, opis FROM zadaci WHERE tenant_id = ? AND id = ?`, tenant, String(b.zadatak_id || ''));
      if (!z) return json({ greska: 'Zadatak ne postoji' }, 404);
      if (z.status !== 'novo') return json({ greska: 'Zadatak je već pokrenut ili zatvoren' }, 409);
      const agent = z.agent === 'claude' ? 'koordinator' : z.agent;
      if (!AGENTI[agent]) return json({ greska: `Agent „${z.agent}” još nije dostupan u izvršitelju. Zadatak preuzima koordinator u idućem pregledu.` }, 422);
      await env.DB.prepare(`UPDATE zadaci SET status = 'u_izradi', version = version + 1 WHERE tenant_id = ? AND id = ? AND status = 'novo'`).bind(tenant, z.id).run();
      const id = await stavi(env, { tenant, agent, vrsta: 'zadatak', opis: z.opis.slice(0, 200), zadatakId: z.id });
      return json({ pokretanje_id: id });
    }
    if (url.pathname === '/pregled') {
      return json({ pokretanje_id: await pokreniPregled(env, tenant, 'Ručno pokrenuto') });
    }
    return json({ greska: 'Nepoznata adresa' }, 404);
  },

  async queue(batch, env) {
    for (const m of batch.messages) {
      try { await obradi(env, m.body); } finally { m.ack(); } // bez automatskog ponavljanja: skup posao
    }
  },

  // Cron: samo zakupci koji su uključili raspored (postavke_json.raspored = true)
  async scheduled(_event, env) {
    const { results } = await env.DB.prepare(`SELECT id FROM tenants`).all();
    for (const t of results) {
      const post = await postavke(env, t.id);
      if (post?.raspored) await pokreniPregled(env, t.id, 'Raspored');
    }
  },
};
