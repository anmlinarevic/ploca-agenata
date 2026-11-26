/* Izvršitelj agenata. Nema javnu adresu: dashboard ga zove preko service bindinga (uz zajednički ključ),
 * a Cron ga budi ponedjeljkom. Posao ide u Queue (jedan po jedan), rezultat i trošak u D1.
 * Piše u `pokretanja`, `zadaci` (status izvođenja), `razgovor` (odgovor koordinatora i obavijesti ploče),
 * `odluke` (zatvaranje odluke kad je agent izvrši) i `audit_log`; sve ostalo agent radi kroz MCP.
 *
 * Tijek: vlasnik piše koordinatoru (/razgovor) ili odobri odluku (/odluka) → koordinator alatom `zadaj_zadatak`
 * daje posao agentima → kad koordinator završi, izvršitelj te zadatke sam stavlja u red → kad agent završi,
 * obavijest ide u razgovor, a odluka se zatvara. */
import { AGENTI, LANCI } from '../../../packages/agenti/index.js';
import { pokreniAgenta } from './agent.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const sada = () => new Date().toISOString();
const novi = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const prvi = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;
const kratko = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const naziv = (agent) => AGENTI[agent]?.naziv || agent;
const POVIJEST = 16; // zadnjih poruka razgovora koje koordinator dobiva

const jedan = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).first();
const nadzor = (env, tenant, akcija, entitet, id, poslije) =>
  env.DB.prepare(`INSERT INTO audit_log (tenant_id, kad, akter, akcija, entitet, entitet_id, poslije_json) VALUES (?, ?, 'izvrsitelj', ?, ?, ?, ?)`)
    .bind(tenant, sada(), akcija, entitet, id, JSON.stringify(poslije));

/** Koordinatorov model i effort mogu se promijeniti varijablama, bez izmjene koda. */
function definicija(env, agent) {
  const def = AGENTI[agent];
  if (!def || agent !== 'koordinator') return def;
  return { ...def, model: env.MODEL_KOORDINATOR || def.model, effort: env.EFFORT_KOORDINATOR || def.effort };
}

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
async function stavi(env, { tenant, agent, vrsta, opis, zadatakId = null, lanac = [], razgovorId = null, odlukaId = null }) {
  const id = novi();
  await env.DB.prepare(
    `INSERT INTO pokretanja (id, tenant_id, zadatak_id, agent, status, kreirano, vrsta, opis, zatim, razgovor_id, odluka_id)
     VALUES (?, ?, ?, ?, 'u_redu', ?, ?, ?, ?, ?, ?)`,
  ).bind(id, tenant, zadatakId, agent, sada(), vrsta, opis, lanac.join(',') || null, razgovorId, odlukaId).run();
  await env.RED.send({ pokretanje_id: id, tenant_id: tenant });
  return id;
}

const zapisiRazgovor = (env, tenant, tko, tekst, pokretanjeId = null) =>
  env.DB.prepare(`INSERT INTO razgovor (id, tenant_id, kad, tko, tekst, pokretanje_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(novi(), tenant, sada(), tko, String(tekst).slice(0, 6000), pokretanjeId).run();

/** Neuspjeli zadatak se vraća u „novo” i više se ne pokreće sam (inače bi se vrtio u krug): čeka vlasnika. */
async function zatvoriZadatak(env, tenant, zadatakId, status, rezultat) {
  if (!zadatakId) return;
  await env.DB.batch([
    env.DB.prepare(`UPDATE zadaci SET status = ?, rezultat = ?, automatski = CASE WHEN ? = 'novo' THEN 0 ELSE automatski END, version = version + 1
                    WHERE tenant_id = ? AND id = ?`)
      .bind(status, (rezultat || '').slice(0, 1000), status, tenant, zadatakId),
    nadzor(env, tenant, 'zadatak_izvrsen', 'zadaci', zadatakId, { status }),
  ]);
}

/** Zadaci koje je koordinator dao (automatski = 1) idu u red čim on završi. */
async function pokreniAutomatske(env, tenant) {
  const { results } = await env.DB.prepare(
    `SELECT id, agent, opis FROM zadaci WHERE tenant_id = ? AND status = 'novo' AND automatski = 1 ORDER BY kreirano`,
  ).bind(tenant).all();
  for (const z of results) {
    if (!AGENTI[z.agent] || z.agent === 'koordinator') {
      await zatvoriZadatak(env, tenant, z.id, 'novo', `Agent „${z.agent}” ne može raditi u izvršitelju.`);
      continue;
    }
    const upd = await env.DB.prepare(`UPDATE zadaci SET status = 'u_izradi', version = version + 1 WHERE tenant_id = ? AND id = ? AND status = 'novo'`)
      .bind(tenant, z.id).run();
    if (upd.meta.changes) await stavi(env, { tenant, agent: z.agent, vrsta: 'zadatak', opis: z.opis.slice(0, 200), zadatakId: z.id });
  }
}

/** Poslije koordinatora: zadatke iz ovog pokretanja veže uz poruku ili odluku, odluku označi, pokrene zadatke.
 * U tom razdoblju radi samo ovaj koordinator (red ima jedan posao istodobno), pa su novi zadaci njegovi. */
async function nakonKoordinatora(env, tenant, p, pocetak, r) {
  if (p.razgovor_id || p.odluka_id) {
    await env.DB.prepare(
      `UPDATE zadaci SET razgovor_id = COALESCE(razgovor_id, ?), odluka_id = COALESCE(odluka_id, ?)
       WHERE tenant_id = ? AND zadao = 'koordinator' AND kreirano >= ?`,
    ).bind(p.razgovor_id, p.odluka_id, tenant, pocetak).run();
  }
  if (p.odluka_id) {
    const o = await jedan(env, `SELECT status FROM odluke WHERE tenant_id = ? AND id = ?`, tenant, p.odluka_id);
    const { results: zad } = await env.DB.prepare(`SELECT agent FROM zadaci WHERE tenant_id = ? AND odluka_id = ? AND kreirano >= ?`)
      .bind(tenant, p.odluka_id, pocetak).all();
    if (o?.status === 'odobreno' && zad.length) {
      await env.DB.prepare(`UPDATE odluke SET status = 'u_izradi', rezultat = ?, ceka_tebe = NULL, version = version + 1 WHERE tenant_id = ? AND id = ? AND status = 'odobreno'`)
        .bind(`Zadano agentu: ${[...new Set(zad.map((z) => naziv(z.agent)))].join(', ')}.`, tenant, p.odluka_id).run();
    } else if (o?.status === 'odobreno' && r?.status === 'uspjeh') {
      // koordinator nije ni rasporedio ni izvršio: neka se vidi da je na vlasniku
      await env.DB.prepare(`UPDATE odluke SET status = 'u_izradi', ceka_tebe = ?, version = version + 1 WHERE tenant_id = ? AND id = ? AND status = 'odobreno'`)
        .bind(kratko(`Koordinator: ${r.rezultat || 'nije našao tko ovo može napraviti.'}`, 500), tenant, p.odluka_id).run();
    }
  }
  await pokreniAutomatske(env, tenant);
}

/** Kad agent završi zadatak koji je dao koordinator: obavijest u razgovor i zatvaranje odluke. */
async function nakonZadatka(env, tenant, zadatakId, status, rezultat, greska) {
  const z = await jedan(env, `SELECT agent, opis, razgovor_id, odluka_id FROM zadaci WHERE tenant_id = ? AND id = ?`, tenant, zadatakId);
  if (!z) return;
  const uspjeh = status === 'uspjeh';
  if (z.odluka_id) {
    if (uspjeh) {
      await env.DB.prepare(
        `UPDATE odluke SET status = 'gotovo', rezultat = ?, ceka_tebe = NULL, version = version + 1
         WHERE tenant_id = ? AND id = ? AND status IN ('odobreno', 'u_izradi')
           AND NOT EXISTS (SELECT 1 FROM zadaci WHERE tenant_id = ? AND odluka_id = ? AND status IN ('novo', 'u_izradi'))`,
      ).bind(kratko(`${naziv(z.agent)}: ${rezultat || 'gotovo.'}`, 600), tenant, z.odluka_id, tenant, z.odluka_id).run();
    } else {
      await env.DB.prepare(`UPDATE odluke SET ceka_tebe = ?, version = version + 1 WHERE tenant_id = ? AND id = ? AND status IN ('odobreno', 'u_izradi')`)
        .bind(kratko(`${naziv(z.agent)} nije uspio (${greska || 'greška'}). Pokreni zadatak ponovno pod Svi zadaci.`, 500), tenant, z.odluka_id).run();
    }
  }
  if (z.razgovor_id) {
    await zapisiRazgovor(env, tenant, 'ploca', uspjeh
      ? `${naziv(z.agent)} je završio „${kratko(z.opis, 90)}”. ${kratko(rezultat, 700)}`
      : `${naziv(z.agent)} nije uspio „${kratko(z.opis, 90)}”: ${kratko(greska, 200)} Zadatak možeš pokrenuti ponovno pod Svi zadaci.`);
  }
}

/** Zadnje poruke razgovora kao poruke za Claude API (vlasnik i obavijesti = user, koordinator = assistant). */
async function povijestRazgovora(env, tenant, danas) {
  const { results } = await env.DB.prepare(`SELECT tko, tekst FROM razgovor WHERE tenant_id = ? ORDER BY kad DESC LIMIT ?`)
    .bind(tenant, POVIJEST).all();
  const poruke = results.reverse().map((m) => (m.tko === 'koordinator'
    ? { role: 'assistant', content: m.tekst }
    : { role: 'user', content: m.tko === 'ploca' ? `[Obavijest ploče, ne piše vlasnik] ${m.tekst}` : m.tekst }));
  while (poruke.length && poruke[0].role !== 'user') poruke.shift();
  while (poruke.length && poruke[poruke.length - 1].role !== 'user') poruke.pop();
  if (!poruke.length) return null;
  const zadnja = poruke[poruke.length - 1];
  zadnja.content = `${zadnja.content}\n\n(Razgovor na ploči. Odgovori vlasniku prema odjeljku „Razgovor s vlasnikom”. Datum: ${danas}.)`;
  return poruke;
}

async function tekstOdluke(env, tenant, odlukaId) {
  const o = await jedan(env, `SELECT * FROM odluke WHERE tenant_id = ? AND id = ?`, tenant, odlukaId);
  if (!o) return null;
  return `Vlasnik je odobrio odluku (odluka_id: ${o.id}). Rasporedi izvršenje prema odjeljku „Odobrena odluka”.\n` +
    `Naslov: ${o.naslov}\nPredložio: ${naziv(o.agent)}\nRazlog: ${o.razlog || '–'}\nPrijedlog: ${o.prijedlog || '–'}\n` +
    `Komentar vlasnika: ${o.komentar || 'nema'}` + (o.ceka_tebe ? `\nPrije je čekalo vlasnika: ${o.ceka_tebe}` : '');
}

async function tekstZadatka(env, tenant, zadatakId) {
  const z = await jedan(env, `SELECT opis, zadao, odluka_id FROM zadaci WHERE tenant_id = ? AND id = ?`, tenant, zadatakId);
  if (!z) return null;
  if (z.zadao !== 'koordinator') return z.opis;
  const o = z.odluka_id ? await jedan(env, `SELECT naslov, prijedlog, komentar FROM odluke WHERE tenant_id = ? AND id = ?`, tenant, z.odluka_id) : null;
  return `${z.opis}\n\n(Zadatak ti je dao koordinator; vlasnik ga je tražio ili odobrio. Radi samo ovaj zadatak, ne cijeli redoviti posao iz ` +
    'svojih uputa; pravila i izvore iz uputa poštuješ. Rezultat spremi alatima ploče kako piše u zadatku. ' +
    'Na kraju napiši sažetak u 3 do 5 rečenica: to vlasnik vidi na ploči.)' +
    (o ? `\nOdobrena odluka koju izvršavaš: „${o.naslov}”. Prijedlog: ${o.prijedlog || '–'}${o.komentar ? ` Komentar vlasnika: ${o.komentar}` : ''}` : '');
}

async function obradi(env, { pokretanje_id: id, tenant_id: tenant }) {
  const p = await jedan(env, `SELECT * FROM pokretanja WHERE tenant_id = ? AND id = ?`, tenant, id);
  if (!p || p.status !== 'u_redu') return; // ponovna isporuka poruke ne smije dvaput trošiti
  const pocetak = sada();
  await env.DB.prepare(`UPDATE pokretanja SET status = 'radi', pocetak = ? WHERE tenant_id = ? AND id = ?`).bind(pocetak, tenant, id).run();

  let zavrseno = false;
  const kraj = async (status, rezultat, greska, ostalo = {}) => {
    if (zavrseno) return; // greška u obradi nakon kraja ne smije dvaput zatvoriti pokretanje
    zavrseno = true;
    const z = ostalo.zbroj;
    await env.DB.prepare(
      `UPDATE pokretanja SET status = ?, kraj = ?, rezultat = ?, greska = ?, model = ?, koraka = ?, pretrage = ?, tokeni_ulaz = ?,
         tokeni_izlaz = ?, tokeni_cache_citanje = ?, tokeni_cache_pisanje = ?, trosak_usd = ? WHERE tenant_id = ? AND id = ?`,
    ).bind(status, sada(), rezultat ?? null, greska ?? null, ostalo.model ?? null, ostalo.koraka ?? 0, z?.pretrage ?? 0, z?.ulaz ?? 0,
      z?.izlaz ?? 0, z?.cacheCitanje ?? 0, z?.cachePisanje ?? 0, ostalo.trosak ?? 0, tenant, id).run();
    try {
      if (p.zadatak_id) {
        if (status === 'uspjeh') await zatvoriZadatak(env, tenant, p.zadatak_id, 'gotovo', rezultat);
        else await zatvoriZadatak(env, tenant, p.zadatak_id, 'novo', `Pokretanje nije uspjelo: ${greska}`);
        await nakonZadatka(env, tenant, p.zadatak_id, status, rezultat, greska);
      }
      if (p.vrsta === 'razgovor') {
        await zapisiRazgovor(env, tenant, 'koordinator', status === 'uspjeh'
          ? (rezultat || 'Gotovo.')
          : `Nisam uspio odgovoriti: ${greska || status}. Pokušaj ponovno malo kasnije.`, id);
      }
      if (p.agent === 'koordinator') await nakonKoordinatora(env, tenant, p, pocetak, { status, rezultat });
    } catch (e) {
      console.error('Obrada nakon pokretanja nije uspjela', id, e);
    }
  };

  try {
    const def = definicija(env, p.agent);
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
    let zadatak = null, poruke = null;
    if (p.vrsta === 'razgovor') {
      poruke = await povijestRazgovora(env, tenant, danas);
      if (!poruke) return await kraj('greska', null, 'Razgovor je prazan.');
    } else if (p.vrsta === 'odluka') {
      zadatak = await tekstOdluke(env, tenant, p.odluka_id);
      if (!zadatak) return await kraj('greska', null, 'Odluka ne postoji.');
    } else if (p.zadatak_id) {
      zadatak = await tekstZadatka(env, tenant, p.zadatak_id);
    } else {
      zadatak = `Radi ${p.vrsta === 'pregled_mjesecni' ? 'mjesečni' : 'tjedni'} pregled prema svojim uputama. (${p.opis})`;
    }
    if (zadatak) zadatak = `${zadatak}\n\n(Datum: ${danas}.)`;
    const r = await pokreniAgenta({ env, definicija: def, token, zadatak, poruke, preostaloUsd: preostalo, danas, nazivZakupca: post.naziv });
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

async function pokreniPregled(env, tenant, vrsta, izvor) {
  const [prvi_, ...ostali] = LANCI[vrsta];
  return stavi(env, { tenant, agent: prvi_, vrsta: `pregled_${vrsta}`, opis: `${izvor}, ${vrsta === 'mjesecni' ? 'mjesečni' : 'tjedni'} pregled`, lanac: ostali });
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
      if (!AGENTI[agent]) return json({ greska: `Agent „${z.agent}” još nije dostupan u izvršitelju. Napiši koordinatoru što treba, pa će naći tko to može.` }, 422);
      await env.DB.prepare(`UPDATE zadaci SET status = 'u_izradi', version = version + 1 WHERE tenant_id = ? AND id = ? AND status = 'novo'`).bind(tenant, z.id).run();
      const id = await stavi(env, { tenant, agent, vrsta: 'zadatak', opis: z.opis.slice(0, 200), zadatakId: z.id });
      return json({ pokretanje_id: id });
    }
    // Poruka vlasnika koordinatoru. Ako koordinator još nije krenuo na prethodnu poruku, ista vožnja odgovara na obje.
    if (url.pathname === '/razgovor') {
      const m = await jedan(env, `SELECT id, tekst FROM razgovor WHERE tenant_id = ? AND id = ? AND tko = 'ti'`, tenant, String(b.poruka_id || ''));
      if (!m) return json({ greska: 'Poruka ne postoji' }, 404);
      const ceka = await jedan(env, `SELECT id FROM pokretanja WHERE tenant_id = ? AND agent = 'koordinator' AND vrsta = 'razgovor' AND status = 'u_redu'`, tenant);
      const id = ceka?.id ?? await stavi(env, { tenant, agent: 'koordinator', vrsta: 'razgovor', opis: kratko(m.tekst, 200), razgovorId: m.id });
      await env.DB.prepare(`UPDATE razgovor SET pokretanje_id = ? WHERE tenant_id = ? AND id = ?`).bind(id, tenant, m.id).run();
      return json({ pokretanje_id: id });
    }
    // Odobrena odluka: koordinator odlučuje tko je izvršava.
    if (url.pathname === '/odluka') {
      const oid = String(b.odluka_id || '');
      const o = await jedan(env, `SELECT id, naslov, status FROM odluke WHERE tenant_id = ? AND id = ?`, tenant, oid);
      if (!o) return json({ greska: 'Odluka ne postoji' }, 404);
      if (!['odobreno', 'u_izradi'].includes(o.status)) return json({ greska: 'Odluka nije odobrena ili je već riješena' }, 409);
      const radi = await jedan(env,
        `SELECT 1 AS da FROM pokretanja WHERE tenant_id = ? AND odluka_id = ? AND status IN ('u_redu', 'radi')
         UNION SELECT 1 FROM zadaci WHERE tenant_id = ? AND odluka_id = ? AND status IN ('novo', 'u_izradi') AND automatski = 1`, tenant, oid, tenant, oid);
      if (radi) return json({ greska: 'Odluka je već kod koordinatora ili agenta' }, 409);
      return json({ pokretanje_id: await stavi(env, { tenant, agent: 'koordinator', vrsta: 'odluka', opis: `Odobreno: ${kratko(o.naslov, 180)}`, odlukaId: oid }) });
    }
    if (url.pathname === '/pregled') {
      const vrsta = b.vrsta === 'mjesecni' ? 'mjesecni' : 'tjedni';
      return json({ pokretanje_id: await pokreniPregled(env, tenant, vrsta, 'Ručno pokrenuto') });
    }
    return json({ greska: 'Nepoznata adresa' }, 404);
  },

  async queue(batch, env) {
    for (const m of batch.messages) {
      try { await obradi(env, m.body); } finally { m.ack(); } // bez automatskog ponavljanja: skup posao
    }
  },

  // Cron: ponedjeljkom tjedni pregled, 1. u mjesecu mjesečni. Samo zakupci s postavke_json.raspored = true.
  // Ako 1. u mjesecu pada u ponedjeljak, radi se samo mjesečni (obuhvaća tjedni).
  async scheduled(event, env) {
    const mjesecni = event.cron === '0 6 1 * *';
    if (!mjesecni && new Date(event.scheduledTime).getUTCDate() === 1) return;
    const { results } = await env.DB.prepare(`SELECT id FROM tenants`).all();
    for (const t of results) {
      const post = await postavke(env, t.id);
      if (post?.raspored) await pokreniPregled(env, t.id, mjesecni ? 'mjesecni' : 'tjedni', 'Raspored');
    }
  },
};
