/* Alati za pisanje (korak 2). Pravila:
 * - agent dolazi iz tokena (ctx.agent), nikad iz argumenata (osim koordinatora koji smije pisati u ime drugih);
 * - svaka promjena ide u istom D1 batchu kao i red u audit_log;
 * - NEMA alata za odobravanje/odbijanje odluka, pisanje u `tjedni` ni brisanje: to radi samo čovjek. */

export const AGENTI = ['koordinator', 'konkurencija', 'seo', 'ai', 'sadrzaj', 'lokalno', 'oglasi', 'materijal'];
const MAX_ODLUKA_TJEDNO = 3;
const KONKURENT_POLJA = {
  naziv: 'text', trziste: 'text', razina: 'text', red: 'int', izvor: 'text', provjereno: 'text',
  proizvod: 'text', cijena_tekst: 'text', velicina: 'text', vrsta: 'text', mjesto: 'text', napomena: 'text',
  usporedba_json: 'json', prednosti_json: 'json',
};

const novi = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const sada = () => new Date().toISOString();
const tekst = (v, ime, max = 4000, obavezno = false) => {
  if (v == null || v === '') { if (obavezno) throw new Error(`Nedostaje: ${ime}`); return null; }
  if (typeof v !== 'string') throw new Error(`${ime} mora biti tekst`);
  if (v.length > max) throw new Error(`${ime} je predug (najviše ${max} znakova)`);
  return v;
};
const cijeli = (v, ime) => {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < 0) throw new Error(`${ime} mora biti cijeli broj ≥ 0`);
  return v;
};
const nadzor = (env, ctx, akcija, entitet, id, prije, poslije) =>
  env.DB.prepare(
    `INSERT INTO audit_log (tenant_id, kad, akter, akcija, entitet, entitet_id, prije_json, poslije_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(ctx.tenantId, sada(), `agent:${ctx.agent}`, akcija, entitet, id,
    prije == null ? null : JSON.stringify(prije), poslije == null ? null : JSON.stringify(poslije));

async function jedan(env, sql, ...args) { return env.DB.prepare(sql).bind(...args).first(); }
const jeKoordinator = (ctx) => ctx.agent === 'koordinator';

const s = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const PISANJE = [
  {
    name: 'dodaj_odluku',
    description: 'Nova odluka za vlasnika (uvijek status "ceka"). Najviše 3 tjedno po agentu. Navedi razlog s podatkom i jasan prijedlog.',
    inputSchema: s({
      naslov: { type: 'string' }, razlog: { type: 'string' }, prijedlog: { type: 'string' },
      poveznica: { type: 'string' }, poveznicaTekst: { type: 'string' },
      prioritet: { type: 'integer', minimum: 1, maximum: 3, default: 2 },
    }, ['naslov', 'razlog', 'prijedlog']),
    run: async (a, ctx, env) => {
      const prioritet = a.prioritet ?? 2;
      if (![1, 2, 3].includes(prioritet)) throw new Error('prioritet mora biti 1, 2 ili 3');
      const o = {
        id: novi(), naslov: tekst(a.naslov, 'naslov', 200, true), razlog: tekst(a.razlog, 'razlog', 4000, true),
        prijedlog: tekst(a.prijedlog, 'prijedlog', 4000, true), poveznica: tekst(a.poveznica, 'poveznica', 500),
        poveznica_tekst: tekst(a.poveznicaTekst, 'poveznicaTekst', 200), prioritet, status: 'ceka', kreirano: sada(),
      };
      const tjedanOd = new Date(Date.now() - 7 * 864e5).toISOString();
      const { n } = await jedan(env,
        `SELECT COUNT(*) AS n FROM odluke WHERE tenant_id = ? AND agent = ? AND kreirano >= ?`,
        ctx.tenantId, ctx.agent, tjedanOd);
      if (n >= MAX_ODLUKA_TJEDNO) throw new Error(`Ograničenje: najviše ${MAX_ODLUKA_TJEDNO} odluke tjedno po agentu`);
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO odluke (id, tenant_id, naslov, agent, razlog, prijedlog, poveznica, poveznica_tekst, prioritet, status, kreirano)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ceka', ?)`,
        ).bind(o.id, ctx.tenantId, o.naslov, ctx.agent, o.razlog, o.prijedlog, o.poveznica, o.poveznica_tekst, o.prioritet, o.kreirano),
        nadzor(env, ctx, 'dodaj_odluku', 'odluke', o.id, null, o),
      ]);
      return { id: o.id, status: 'ceka' };
    },
  },
  {
    name: 'azuriraj_odluku_izvrsenje',
    description: 'Izvršenje ODOBRENE odluke: status "u_izradi" ili "gotovo", uz rezultat (jedna rečenica) i poveznicu. Ne mijenja odobrenje ni komentar.',
    inputSchema: s({
      id: { type: 'string' }, status: { type: 'string', enum: ['u_izradi', 'gotovo'] },
      rezultat: { type: 'string' }, poveznica: { type: 'string' }, if_version: { type: 'integer' },
    }, ['id', 'status']),
    run: async (a, ctx, env) => {
      if (!['u_izradi', 'gotovo'].includes(a.status)) throw new Error('status mora biti u_izradi ili gotovo');
      const stara = await jedan(env, `SELECT * FROM odluke WHERE tenant_id = ? AND id = ?`, ctx.tenantId, a.id);
      if (!stara) throw new Error('Odluka ne postoji');
      if (!['odobreno', 'u_izradi'].includes(stara.status)) throw new Error(`Odluka nije odobrena (status: ${stara.status})`);
      if (a.if_version != null && a.if_version !== stara.version) throw new Error(`Odluka je u međuvremenu promijenjena (verzija ${stara.version})`);
      const rezultat = tekst(a.rezultat, 'rezultat', 1000) ?? stara.rezultat;
      const poveznica = tekst(a.poveznica, 'poveznica', 500) ?? stara.poveznica;
      if (a.status === 'gotovo' && !rezultat) throw new Error('Za "gotovo" je obavezan rezultat');
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE odluke SET status = ?, rezultat = ?, poveznica = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND version = ?`,
        ).bind(a.status, rezultat, poveznica, ctx.tenantId, a.id, stara.version),
        nadzor(env, ctx, 'azuriraj_odluku_izvrsenje', 'odluke', a.id,
          { status: stara.status, rezultat: stara.rezultat }, { status: a.status, rezultat, poveznica }),
      ]);
      return { id: a.id, status: a.status, version: stara.version + 1 };
    },
  },
  {
    name: 'azuriraj_zadatak',
    description: 'Napredak zadatka koji je vlasnik zadao: status (u_izradi, gotovo, odbijeno), rezultat, poveznica, sesija. Agent smije samo svoje zadatke; koordinator sve.',
    inputSchema: s({
      id: { type: 'string' }, status: { type: 'string', enum: ['u_izradi', 'gotovo', 'odbijeno'] },
      rezultat: { type: 'string' }, poveznica: { type: 'string' }, sesija: { type: 'string' },
    }, ['id', 'status']),
    run: async (a, ctx, env) => {
      if (!['u_izradi', 'gotovo', 'odbijeno'].includes(a.status)) throw new Error('Neispravan status');
      const stari = await jedan(env, `SELECT * FROM zadaci WHERE tenant_id = ? AND id = ?`, ctx.tenantId, a.id);
      if (!stari) throw new Error('Zadatak ne postoji');
      if (!jeKoordinator(ctx) && stari.agent !== ctx.agent) throw new Error('Zadatak je dodijeljen drugom agentu');
      const rezultat = tekst(a.rezultat, 'rezultat', 1000) ?? stari.rezultat;
      const poveznica = tekst(a.poveznica, 'poveznica', 500) ?? stari.poveznica;
      const sesija = tekst(a.sesija, 'sesija', 500) ?? stari.sesija;
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE zadaci SET status = ?, rezultat = ?, poveznica = ?, sesija = ?, version = version + 1
           WHERE tenant_id = ? AND id = ?`,
        ).bind(a.status, rezultat, poveznica, sesija, ctx.tenantId, a.id),
        nadzor(env, ctx, 'azuriraj_zadatak', 'zadaci', a.id, { status: stari.status }, { status: a.status, rezultat }),
      ]);
      return { id: a.id, status: a.status };
    },
  },
  {
    name: 'upisi_mjesecno',
    description: 'Mjesečni pregled: AI test (aiSpominjanja od aiPitanja) i Search Console. Ključ mjesec je GGGG-MM. Polja koja ne pošalješ ostaju kakva jesu.',
    inputSchema: s({
      mjesec: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
      aiSpominjanja: { type: 'integer' }, aiPitanja: { type: 'integer' },
      gscKlikovi: { type: 'integer' }, gscPojavljivanja: { type: 'integer' }, napomena: { type: 'string' },
    }, ['mjesec']),
    run: async (a, ctx, env) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(a.mjesec || '')) throw new Error('mjesec mora biti GGGG-MM');
      const stari = await jedan(env, `SELECT * FROM mjesecno WHERE tenant_id = ? AND mjesec = ?`, ctx.tenantId, a.mjesec);
      const n = {
        ai_spominjanja: cijeli(a.aiSpominjanja, 'aiSpominjanja') ?? stari?.ai_spominjanja ?? null,
        ai_pitanja: cijeli(a.aiPitanja, 'aiPitanja') ?? stari?.ai_pitanja ?? null,
        gsc_klikovi: cijeli(a.gscKlikovi, 'gscKlikovi') ?? stari?.gsc_klikovi ?? null,
        gsc_pojavljivanja: cijeli(a.gscPojavljivanja, 'gscPojavljivanja') ?? stari?.gsc_pojavljivanja ?? null,
        napomena: tekst(a.napomena, 'napomena', 2000) ?? stari?.napomena ?? null,
      };
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO mjesecno (tenant_id, mjesec, ai_spominjanja, ai_pitanja, gsc_klikovi, gsc_pojavljivanja, napomena)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (tenant_id, mjesec) DO UPDATE SET ai_spominjanja = excluded.ai_spominjanja,
             ai_pitanja = excluded.ai_pitanja, gsc_klikovi = excluded.gsc_klikovi,
             gsc_pojavljivanja = excluded.gsc_pojavljivanja, napomena = excluded.napomena`,
        ).bind(ctx.tenantId, a.mjesec, n.ai_spominjanja, n.ai_pitanja, n.gsc_klikovi, n.gsc_pojavljivanja, n.napomena),
        nadzor(env, ctx, 'upisi_mjesecno', 'mjesecno', a.mjesec, stari ?? null, n),
      ]);
      return { mjesec: a.mjesec, ...n };
    },
  },
  {
    name: 'oznaci_napredak',
    description: 'Kvačica na stavci plana (faza0..faza3, redni broj stavke od 0). Ne briše i ne dodaje stavke.',
    inputSchema: s({
      faza: { type: 'string' }, red: { type: 'integer', minimum: 0 }, gotovo: { type: 'boolean' },
    }, ['faza', 'red', 'gotovo']),
    run: async (a, ctx, env) => {
      const stara = await jedan(env,
        `SELECT t, gotovo FROM napredak_stavke WHERE tenant_id = ? AND faza_id = ? AND red = ?`, ctx.tenantId, a.faza, a.red);
      if (!stara) throw new Error('Stavka ne postoji');
      await env.DB.batch([
        env.DB.prepare(`UPDATE napredak_stavke SET gotovo = ? WHERE tenant_id = ? AND faza_id = ? AND red = ?`)
          .bind(a.gotovo ? 1 : 0, ctx.tenantId, a.faza, a.red),
        nadzor(env, ctx, 'oznaci_napredak', 'napredak_stavke', `${a.faza}/${a.red}`, { gotovo: !!stara.gotovo }, { gotovo: !!a.gotovo }),
      ]);
      return { stavka: stara.t, gotovo: !!a.gotovo };
    },
  },
  {
    name: 'dodaj_aktivnost',
    description: 'Jedan zapis u dnevnik rada po bitnom događaju, s poveznicom. Koordinator smije navesti agent (u ime drugog agenta).',
    inputSchema: s({ sto: { type: 'string' }, poveznica: { type: 'string' }, agent: { type: 'string', enum: AGENTI } }, ['sto']),
    run: async (a, ctx, env) => {
      const agent = a.agent && jeKoordinator(ctx) ? a.agent : ctx.agent;
      if (a.agent && !AGENTI.includes(a.agent)) throw new Error('Nepoznat agent');
      const z = { id: novi(), kad: sada(), agent, sto: tekst(a.sto, 'sto', 500, true), poveznica: tekst(a.poveznica, 'poveznica', 500) };
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO aktivnost (id, tenant_id, kad, agent, sto, poveznica) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(z.id, ctx.tenantId, z.kad, z.agent, z.sto, z.poveznica),
        nadzor(env, ctx, 'dodaj_aktivnost', 'aktivnost', z.id, null, z),
      ]);
      return { id: z.id };
    },
  },
  {
    name: 'azuriraj_konkurenta',
    description: `Promjena u registru konkurenata (cijena, rok, dostava, napomena...). Dopuštena polja: ${Object.keys(KONKURENT_POLJA).join(', ')}. Za NAŠ red (mi) obavezno navedi odluka_id odobrene odluke. Nov konkurent: navedi novi id i naziv.`,
    inputSchema: s({
      id: { type: 'string', pattern: '^[a-z0-9-]{2,40}$' },
      polja: { type: 'object' },
      odluka_id: { type: 'string' },
    }, ['id', 'polja']),
    run: async (a, ctx, env) => {
      if (!/^[a-z0-9-]{2,40}$/.test(a.id || '')) throw new Error('id: mala slova, brojke i crtice');
      const polja = a.polja || {};
      const kljucevi = Object.keys(polja);
      if (!kljucevi.length) throw new Error('Nema polja za promjenu');
      for (const k of kljucevi) if (!(k in KONKURENT_POLJA)) throw new Error(`Polje nije dopušteno: ${k}`);
      const stari = await jedan(env, `SELECT * FROM konkurenti WHERE tenant_id = ? AND id = ?`, ctx.tenantId, a.id);
      if (stari?.mi) {
        const od = a.odluka_id && await jedan(env,
          `SELECT status FROM odluke WHERE tenant_id = ? AND id = ?`, ctx.tenantId, a.odluka_id);
        if (!od || !['odobreno', 'u_izradi'].includes(od.status)) throw new Error('Naš red se mijenja samo uz odobrenu odluku (odluka_id)');
      }
      const vrijednosti = kljucevi.map((k) => {
        const v = polja[k], tip = KONKURENT_POLJA[k];
        if (tip === 'json') return v == null ? null : JSON.stringify(v);
        if (tip === 'int') return cijeli(v, k);
        return tekst(v, k, 2000);
      });
      if (!stari) {
        if (!polja.naziv) throw new Error('Novi konkurent traži naziv');
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO konkurenti (id, tenant_id, ${kljucevi.join(', ')}) VALUES (?, ?, ${kljucevi.map(() => '?').join(', ')})`)
            .bind(a.id, ctx.tenantId, ...vrijednosti),
          nadzor(env, ctx, 'azuriraj_konkurenta', 'konkurenti', a.id, null, polja),
        ]);
      } else {
        const prije = Object.fromEntries(kljucevi.map((k) => [k, stari[k]]));
        await env.DB.batch([
          env.DB.prepare(`UPDATE konkurenti SET ${kljucevi.map((k) => `${k} = ?`).join(', ')} WHERE tenant_id = ? AND id = ?`)
            .bind(...vrijednosti, ctx.tenantId, a.id),
          nadzor(env, ctx, 'azuriraj_konkurenta', 'konkurenti', a.id, prije, polja),
        ]);
      }
      return { id: a.id, promijenjeno: kljucevi };
    },
  },
  {
    name: 'spremi_izvjestaj',
    description: 'Spremi izvještaj agenta (Markdown) koji vlasnik čita na ploči. Naslov kratak, tijelo najviše 40000 znakova.',
    inputSchema: s({ naslov: { type: 'string' }, tijelo: { type: 'string' } }, ['naslov', 'tijelo']),
    run: async (a, ctx, env) => {
      const r = { id: novi(), kad: sada(), naslov: tekst(a.naslov, 'naslov', 200, true), tijelo: tekst(a.tijelo, 'tijelo', 40000, true) };
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO izvjestaji (id, tenant_id, agent, kad, naslov, tijelo) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(r.id, ctx.tenantId, ctx.agent, r.kad, r.naslov, r.tijelo),
        nadzor(env, ctx, 'spremi_izvjestaj', 'izvjestaji', r.id, null, { naslov: r.naslov, znakova: r.tijelo.length }),
      ]);
      return { id: r.id };
    },
  },
];
