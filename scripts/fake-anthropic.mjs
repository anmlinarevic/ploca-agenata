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

function scenarij(telo) {
  const sustav = typeof telo.system === 'string' ? telo.system : JSON.stringify(telo.system);
  const korak = telo.messages.filter((m) => m.role === 'assistant').length + 1;
  const konkurencija = sustav.includes('praćenje konkurencije');
  if (konkurencija) {
    if (korak === 1) return odgovor([{ type: 'text', text: 'Pogledat ću registar.' }, tool('t1', 'dohvati_konkurente', {})], 'tool_use', { input_tokens: 20000, output_tokens: 500 });
    if (korak === 2) return odgovor([
      tool('t2', 'azuriraj_konkurenta', { id: 'imemojemalo', polja: { napomena: 'Lažna provjera', provjereno: '2026-11-21' } }),
      tool('t3', 'spremi_izvjestaj', { naslov: 'Konkurencija (test)', tijelo: '## Promjene\nBez bitnih promjena.' }),
      tool('t4', 'obrisi_sve', {}), // nepostojeći alat: izvršitelj mora vratiti is_error, ne srušiti se
    ], 'tool_use', { input_tokens: 4000, output_tokens: 800, cache_read_input_tokens: 20000 });
    return odgovor([{ type: 'text', text: 'Sažetak: bez promjena.' }], 'end_turn',
      { input_tokens: 3000, output_tokens: 300, cache_read_input_tokens: 24000, server_tool_use: { web_search_requests: 2 } });
  }
  // koordinator
  if (korak === 1) return odgovor([tool('k1', 'izvezi_ploca', {})], 'tool_use', { input_tokens: 5000, output_tokens: 200 });
  if (korak === 2) return odgovor([tool('k2', 'spremi_izvjestaj', { naslov: 'Tjedni pregled (test)', tijelo: '## Za odluku\nNema.' })], 'tool_use', { input_tokens: 3000, output_tokens: 600 });
  return odgovor([{ type: 'text', text: 'Za odluku: nema.' }], 'end_turn', { input_tokens: 2000, output_tokens: 100 });
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/zahtjevi') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(zahtjevi)); }
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    let tijelo = '';
    req.on('data', (d) => (tijelo += d));
    req.on('end', () => {
      const telo = JSON.parse(tijelo);
      zahtjevi.push({ model: telo.model, alati: (telo.tools || []).map((t) => t.name), cache: !!telo.cache_control, effort: telo.output_config?.effort, poruka: telo.messages.length,
        zadnjaPoruka: telo.messages[telo.messages.length - 1] });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(scenarij(telo)));
    });
    return;
  }
  res.statusCode = 404; res.end('{}');
}).listen(port, () => console.log(`fake-anthropic na ${port}`));
