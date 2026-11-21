// Dimni test: pokreni `npm run dev` (lokalna baza s migracijama i uvozom), pa `npm test`.
// Treba TOKEN u okolini (ispis scripts/novi-token.mjs) i neobavezno URL (zadano http://localhost:8787).
const URL_ = process.env.URL || 'http://localhost:8787';
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('Postavi TOKEN'); process.exit(1); }

let id = 0;
async function rpc(method, params, token = TOKEN) {
  const r = await fetch(`${URL_}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
}
const ok = (c, m) => { if (!c) { console.error('PAO:', m); process.exitCode = 1; } else console.log('ok  ', m); };

ok((await rpc('tools/list', {}, 'pogresan')).status === 401, 'pogrešan token → 401');
const lista = await rpc('tools/list');
ok(lista.body.result.tools.length >= 9, `tools/list vraća alate (${lista.body.result.tools.length})`);
const poziv = async (name, args = {}) =>
  JSON.parse((await rpc('tools/call', { name, arguments: args })).body.result.content[0].text);

const odluke = await poziv('dohvati_otvorene_odluke');
ok(Array.isArray(odluke) && odluke.every((o) => o.status === 'ceka'), `otvorene odluke: ${odluke.length}`);
const konk = await poziv('dohvati_konkurente');
ok(konk.length === 12, `konkurenti: ${konk.length}`);
ok(konk.find((k) => k.id === 'imemojemalo')?.usporedba?.c3?.n === 35, 'JSON polje usporedba se vraća kao objekt');
const napredak = await poziv('dohvati_napredak');
ok(napredak.length === 4 && napredak[0].stavke.length === 10, 'napredak: 4 faze, faza0 ima 10 stavki');
const izvoz = await poziv('izvezi_ploca');
ok('odobreneOdluke' in izvoz && 'napredak' in izvoz, 'izvezi_ploca');
const nepoznat = await rpc('tools/call', { name: 'obrisi_sve', arguments: {} });
ok(nepoznat.body.error?.code === -32602, 'nepoznat alat se odbija');
