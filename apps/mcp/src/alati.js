/* Alati za čitanje (korak 1). Svaki upit ima tenant_id iz tokena kao prvi uvjet. */

const ograniči = (n, def, max) => Math.min(Math.max(parseInt(n ?? def, 10) || def, 1), max);
const parse = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };

const dokument = (r, jsonStupci = []) => {
  const { tenant_id, ...ostalo } = r;
  for (const k of jsonStupci) if (k in ostalo) ostalo[k.replace(/_json$/, '')] = parse(ostalo[k]), delete ostalo[k];
  return ostalo;
};

async function sve(env, sql, ...args) {
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return results;
}

const prazno = { type: 'object', properties: {}, additionalProperties: false };
const limitSchema = (def) => ({
  type: 'object',
  properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: def } },
  additionalProperties: false,
});

export const TOOLS = [
  {
    name: 'dohvati_odobrene_odluke',
    description: 'Odluke koje je vlasnik odobrio ili odbio, a još nemaju rezultat (agent ih treba izvršiti ili upisati u dnevnik).',
    inputSchema: prazno,
    run: async (_a, { tenantId }, env) => (await sve(env,
      `SELECT * FROM odluke WHERE tenant_id = ? AND status IN ('odobreno','odbijeno') AND (rezultat IS NULL OR rezultat = '')
       ORDER BY prioritet, kreirano`, tenantId)).map((r) => dokument(r)),
  },
  {
    name: 'dohvati_nove_zadatke',
    description: 'Zadaci koje je vlasnik zadao agentima, sa statusom "novo".',
    inputSchema: prazno,
    run: async (_a, { tenantId }, env) => (await sve(env,
      `SELECT * FROM zadaci WHERE tenant_id = ? AND status = 'novo' ORDER BY kreirano`, tenantId)).map((r) => dokument(r)),
  },
  {
    name: 'dohvati_otvorene_odluke',
    description: 'Odluke koje čekaju vlasnika (status "ceka"). Služi da agent ne predloži isto dvaput.',
    inputSchema: prazno,
    run: async (_a, { tenantId }, env) => (await sve(env,
      `SELECT * FROM odluke WHERE tenant_id = ? AND status = 'ceka' ORDER BY prioritet, kreirano`, tenantId)).map((r) => dokument(r)),
  },
  {
    name: 'dohvati_tjedne',
    description: 'Zadnjih N tjednih zapisa (upiti, narudžbe, izvori) koje upisuje vlasnik.',
    inputSchema: limitSchema(8),
    run: async (a, { tenantId }, env) => (await sve(env,
      `SELECT * FROM tjedni WHERE tenant_id = ? ORDER BY tjedan DESC LIMIT ?`, tenantId, ograniči(a.limit, 8, 200)))
      .map((r) => dokument(r, ['izvori_json'])),
  },
  {
    name: 'dohvati_mjesecno',
    description: 'Zadnjih N mjesečnih zapisa (AI test, Search Console).',
    inputSchema: limitSchema(3),
    run: async (a, { tenantId }, env) => (await sve(env,
      `SELECT * FROM mjesecno WHERE tenant_id = ? ORDER BY mjesec DESC LIMIT ?`, tenantId, ograniči(a.limit, 3, 200)))
      .map((r) => dokument(r)),
  },
  {
    name: 'dohvati_aktivnost',
    description: 'Zadnjih N zapisa dnevnika rada.',
    inputSchema: limitSchema(40),
    run: async (a, { tenantId }, env) => (await sve(env,
      `SELECT * FROM aktivnost WHERE tenant_id = ? ORDER BY kad DESC LIMIT ?`, tenantId, ograniči(a.limit, 40, 200)))
      .map((r) => dokument(r)),
  },
  {
    name: 'dohvati_napredak',
    description: 'Faze plana sa stavkama i kvačicama.',
    inputSchema: prazno,
    run: async (_a, { tenantId }, env) => {
      const faze = await sve(env, `SELECT id, naziv, kad, red FROM napredak_faze WHERE tenant_id = ? ORDER BY red`, tenantId);
      const stavke = await sve(env,
        `SELECT faza_id, t, gotovo, tko FROM napredak_stavke WHERE tenant_id = ? ORDER BY faza_id, red`, tenantId);
      return faze.map((f) => ({ ...f, stavke: stavke.filter((s) => s.faza_id === f.id)
        .map(({ t, gotovo, tko }) => ({ t, gotovo: !!gotovo, tko })) }));
    },
  },
  {
    name: 'dohvati_konkurente',
    description: 'Registar konkurenata s cijenama i prednostima. Neobavezan filter: trziste (HR, SI, lokalno).',
    inputSchema: { type: 'object', properties: { trziste: { type: 'string', enum: ['HR', 'SI', 'lokalno'] } }, additionalProperties: false },
    run: async (a, { tenantId }, env) => (await (a.trziste
      ? sve(env, `SELECT * FROM konkurenti WHERE tenant_id = ? AND trziste = ? ORDER BY red`, tenantId, a.trziste)
      : sve(env, `SELECT * FROM konkurenti WHERE tenant_id = ? ORDER BY red`, tenantId)))
      .map((r) => dokument(r, ['usporedba_json', 'prednosti_json'])),
  },
];

TOOLS.push({
  name: 'izvezi_ploca',
  description: 'Sve odjednom za koordinatora: odobrene odluke, novi zadaci, zadnji tjedni i mjesečno, napredak. Zamjena za izvoz u podaci/ploca/.',
  inputSchema: prazno,
  run: async (a, ctx, env) => {
    const poImenu = (n) => TOOLS.find((t) => t.name === n).run({}, ctx, env);
    const [odluke, zadaci, tjedni, mjesecno, napredak] = await Promise.all([
      poImenu('dohvati_odobrene_odluke'), poImenu('dohvati_nove_zadatke'),
      poImenu('dohvati_tjedne'), poImenu('dohvati_mjesecno'), poImenu('dohvati_napredak'),
    ]);
    return { odobreneOdluke: odluke, noviZadaci: zadaci, tjedni, mjesecno, napredak };
  },
});

export async function pozoviAlat(alat, args, ctx, env) {
  return alat.run(args, ctx, env);
}
