/* Procjena troška iz `usage` odgovora. Cijene su USD po milijun tokena i ovise o modelu; zadane vrijednosti
 * (Claude Sonnet 5.5: ulaz 2, izlaz 10, čitanje iz cachea 0,10, pisanje u cache 2,50) i cijena pretrage
 * postavljaju se u wrangler.jsonc ("vars") i treba ih provjeriti na Anthropicovu cjeniku. */
const broj = (v, zadano) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : zadano; };

// Cjenik po modelu (USD po milijun tokena). CENA_* u wrangler.jsonc vrijede za zadani model (env.MODEL).
const CJENIK = {
  'claude-sonnet-5-5': { ulaz: 2, izlaz: 10, cacheCitanje: 0.1, cachePisanje: 2.5 },
  'claude-opus-5-5': { ulaz: 4, izlaz: 20, cacheCitanje: 0.2, cachePisanje: 5 },
};

export function cijene(env, model = env.MODEL) {
  const z = CJENIK[model] || CJENIK['claude-sonnet-5-5'];
  const zadani = !model || model === (env.MODEL || 'claude-sonnet-5-5');
  return {
    ulaz: zadani ? broj(env.CENA_ULAZ, z.ulaz) : z.ulaz, izlaz: zadani ? broj(env.CENA_IZLAZ, z.izlaz) : z.izlaz,
    cacheCitanje: zadani ? broj(env.CENA_CACHE_CITANJE, z.cacheCitanje) : z.cacheCitanje,
    cachePisanje: zadani ? broj(env.CENA_CACHE_PISANJE, z.cachePisanje) : z.cachePisanje,
    pretraga: broj(env.CENA_PRETRAGA, 0.01), // USD po jednoj pretrazi (procjena)
  };
}

export function prazanZbroj() {
  return { ulaz: 0, izlaz: 0, cacheCitanje: 0, cachePisanje: 0, pretrage: 0 };
}

export function dodaj(zbroj, usage) {
  zbroj.ulaz += usage?.input_tokens || 0;
  zbroj.izlaz += usage?.output_tokens || 0;
  zbroj.cacheCitanje += usage?.cache_read_input_tokens || 0;
  zbroj.cachePisanje += usage?.cache_creation_input_tokens || 0;
  zbroj.pretrage += usage?.server_tool_use?.web_search_requests || 0;
}

export function usd(zbroj, c) {
  return (zbroj.ulaz * c.ulaz + zbroj.izlaz * c.izlaz + zbroj.cacheCitanje * c.cacheCitanje + zbroj.cachePisanje * c.cachePisanje) / 1e6
    + zbroj.pretrage * c.pretraga;
}
