// Lažni Claude API za lokalne testove izvršitelja (nema troška, nema ključa).
// Scenarij po agentu; svaki zahtjev se bilježi i može se pročitati na GET /zahtjevi.
import http from 'node:http';

const port = Number(process.env.PORT || 8790);
const zahtjevi = [];

const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const odgovor = (content, stop_reason, usage) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason, stop_sequence: null,
  usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
});

// Po jednoj karakterističnoj frazi iz uputa agenta
const AGENTI = [
  ['konkurencija', 'praćenje konkurencije'], ['koordinator', 'Vlasnik razgovara samo s tobom'], ['seo', 'SEO agent obrta'],
  ['ai', 'agent za AI vidljivost'], ['sadrzaj', 'agent za sadržaj obrta'], ['lokalno', 'agent za lokalni marketing'], ['oglasi', 'agent za oglase'],
];
const koji = (telo) => {
  const sustav = typeof telo.system === 'string' ? telo.system : JSON.stringify(telo.system);
  return AGENTI.find(([, fraza]) => sustav.includes(fraza))?.[0] ?? 'nepoznat';
};
/** Rezultat zadnjeg alata iz zadnje korisničke poruke, kao objekt (ili null). */
const zadnjiRezultat = (telo) => {
  const m = telo.messages[telo.messages.length - 1];
  const t = Array.isArray(m.content) ? m.content.find((c) => c.type === 'tool_result')?.content : null;
  try { return JSON.parse(typeof t === 'string' ? t : t?.[0]?.text); } catch { return null; }
};

function scenarij(telo, agent) {
  const korak = telo.messages.filter((m) => m.role === 'assistant').length + 1;
  if (agent === 'konkurencija') {
    if (korak === 1) return odgovor([{ type: 'text', text: 'Pogledat ću registar.' }, tool('t1', 'dohvati_konkurente', {})], 'tool_use', { input_tokens: 20000, output_tokens: 500 });
    if (korak === 2) return odgovor([
      tool('t2', 'azuriraj_konkurenta', { id: 'imemojemalo', polja: { napomena: 'Lažna provjera', provjereno: '2026-11-21' } }),
      tool('t3', 'spremi_izvjestaj', { naslov: 'Konkurencija (test)', tijelo: '## Promjene\nBez bitnih promjena.' }),
      tool('t4', 'obrisi_sve', {}), // nepostojeći alat: izvršitelj mora vratiti is_error, ne srušiti se
    ], 'tool_use', { input_tokens: 4000, output_tokens: 800, cache_read_input_tokens: 20000 });
    return odgovor([{ type: 'text', text: 'Sažetak: bez promjena.' }], 'end_turn',
      { input_tokens: 3000, output_tokens: 300, cache_read_input_tokens: 24000, server_tool_use: { web_search_requests: 2 } });
  }
  if (agent === 'koordinator') {
    const sve = JSON.stringify(telo.messages);
    // razgovor s vlasnikom: daje zadatak Sadržaju i traži pristup koji fali
    if (sve.includes('Razgovor na ploči')) {
      if (korak === 1) return odgovor([
        tool('r1', 'zadaj_zadatak', { agent: 'sadrzaj', opis: 'Napiši nacrt vodiča „Poklon za krštenje” (test) i spremi ga kao izvještaj s naslovom „Nacrt vodiča: test”.' }),
        tool('r2', 'zatrazi_pristup', { sto: 'GitHub token samo za pull request (test)', zasto: 'Bez njega nijedan agent ne može predložiti izmjenu stranice.', kako: 'Napravi fine-grained token za repozitorij stranice.' }),
      ], 'tool_use', { input_tokens: 4000, output_tokens: 300 });
      return odgovor([{ type: 'text', text: 'Dao sam Sadržaju da napiše nacrt; javit ću kad bude gotov. Za izmjene stranice treba GitHub pristup.' }], 'end_turn', { input_tokens: 1500, output_tokens: 80 });
    }
    // odobrena odluka: daje je Sadržaju uz odluka_id
    const odl = /odluka_id: ([\w-]+)/.exec(sve);
    if (odl && sve.includes('Vlasnik je odobrio odluku')) {
      if (korak === 1) return odgovor([tool('o1', 'zadaj_zadatak', { agent: 'sadrzaj', opis: 'Izvrši odobrenu odluku (test): napiši tekst i spremi ga kao izvještaj.', odluka_id: odl[1] })], 'tool_use', { input_tokens: 3000, output_tokens: 200 });
      return odgovor([{ type: 'text', text: 'Sadržaj izvršava odluku.' }], 'end_turn', { input_tokens: 1000, output_tokens: 40 });
    }
    if (korak === 1) return odgovor([tool('k1', 'izvezi_ploca', {})], 'tool_use', { input_tokens: 5000, output_tokens: 200 });
    if (korak === 2) return odgovor([tool('k2', 'spremi_izvjestaj', { naslov: 'Tjedni pregled (test)', tijelo: '## Za odluku\nNema.' })], 'tool_use', { input_tokens: 3000, output_tokens: 600 });
    return odgovor([{ type: 'text', text: 'Za odluku: nema.' }], 'end_turn', { input_tokens: 2000, output_tokens: 100 });
  }
  if (agent === 'seo') {
    if (korak === 1) return odgovor([tool('s1', 'dohvati_registar', { kljuc: 'kljucne-rijeci' })], 'tool_use', { input_tokens: 3000, output_tokens: 100 });
    if (korak === 2) {
      const reg = zadnjiRezultat(telo) || { tijelo: '', verzija: 0 };
      return odgovor([
        tool('s2', 'spremi_registar', { kljuc: 'kljucne-rijeci', tijelo: reg.tijelo + '\n\n- Test dodatak (SEO)', if_verzija: reg.verzija }),
        tool('s3', 'spremi_registar', { kljuc: 'partneri', tijelo: 'tuđi registar', if_verzija: 1 }), // SEO ne smije: mora biti is_error
        tool('s4', 'spremi_izvjestaj', { naslov: 'SEO pregled (test)', tijelo: '## Nalazi\nNema.' }),
      ], 'tool_use', { input_tokens: 2000, output_tokens: 400 });
    }
    return odgovor([{ type: 'text', text: 'SEO: bez prijedloga.' }], 'end_turn', { input_tokens: 1500, output_tokens: 100 });
  }
  // ostali agenti (ai, sadrzaj, lokalno, oglasi): pročitaj popis registara pa spremi izvještaj
  if (korak === 1) return odgovor([tool('o1', 'dohvati_registar', {})], 'tool_use', { input_tokens: 2000, output_tokens: 100 });
  if (korak === 2) return odgovor([tool('o2', 'spremi_izvjestaj', { naslov: `${agent} (test)`, tijelo: `## Nalazi\n${agent}: nema.` })], 'tool_use', { input_tokens: 1500, output_tokens: 300 });
  return odgovor([{ type: 'text', text: `${agent}: gotovo.` }], 'end_turn', { input_tokens: 1000, output_tokens: 80 });
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/zahtjevi') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(zahtjevi)); }
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    let tijelo = '';
    req.on('data', (d) => (tijelo += d));
    req.on('end', () => {
      const telo = JSON.parse(tijelo);
      const agent = koji(telo);
      zahtjevi.push({ agent, model: telo.model, alati: (telo.tools || []).map((t) => t.name), cache: !!telo.cache_control, effort: telo.output_config?.effort,
        fallbacks: telo.fallbacks, beta: req.headers['anthropic-beta'] || null,
        poruka: telo.messages.length, zadnjaPoruka: telo.messages[telo.messages.length - 1] });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(scenarij(telo, agent)));
    });
    return;
  }
  res.statusCode = 404; res.end('{}');
}).listen(port, () => console.log(`fake-anthropic na ${port}`));
