/* Procjena troška iz `usage` odgovora. Cijene su USD po milijun tokena i ovise o modelu; zadane vrijednosti
 * (Claude Sonnet 5.5: ulaz 2, izlaz 10, čitanje iz cachea 0,10, pisanje u cache 2,50) i cijena pretrage
 * postavljaju se u wrangler.jsonc ("vars") i treba ih provjeriti na Anthropicovu cjeniku. */
const broj = (v, zadano) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : zadano; };

export function cijene(env) {
  return {
    ulaz: broj(env.CENA_ULAZ, 2), izlaz: broj(env.CENA_IZLAZ, 10),
    cacheCitanje: broj(env.CENA_CACHE_CITANJE, 0.1), cachePisanje: broj(env.CENA_CACHE_PISANJE, 2.5),
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
