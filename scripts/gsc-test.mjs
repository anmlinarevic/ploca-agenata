// Google Search Console → ekran Web, protiv pokrenutog dashboarda (DEV_USER='*') i lažnog Googlea (scripts/fake-gsc.mjs).
// Okolina: URL (dashboard), GSC (lažni Google).
const URL_ = process.env.URL || 'http://localhost:8798';
const GSC = process.env.GSC || 'http://localhost:8793';
const ok = (c, m) => { if (!c) { console.error('PAO:', m); process.exitCode = 1; } else console.log('ok  ', m); };

async function zovi(metoda, put, tijelo, korisnik = 'vlasnik@test.hr', tenant) {
  const h = { 'x-dev-user': korisnik };
  if (tenant) h['x-tenant'] = tenant;
  if (tijelo !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(URL_ + put, { method: metoda, headers: h, body: tijelo !== undefined ? JSON.stringify(tijelo) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, d, t };
}
const web = async () => (await zovi('GET', '/api/web')).d;

let w = await web();
ok(w.gsc.spojeno && !w.gsc.zadnje && !w.zadnjih && w.upiti.length === 0, 'prije prve sinkronizacije: spojeno, ali još nema podataka');

const s1 = await zovi('POST', '/api/gsc/osvjezi', {});
ok(s1.status === 200 && s1.d.stavki === 12 && s1.d.provjereno === 4, `prva sinkronizacija: ${s1.d?.stavki} stavki, ${s1.d?.provjereno} provjerenih adresa` + (s1.status === 200 ? '' : ` (${s1.status} ${s1.t})`));

w = await web();
ok(!w.gsc.greska && w.gsc.racun === 'ploca@test-projekt.iam.gserviceaccount.com' && w.gsc.svojstvo === 'sc-domain:piccoliniplay.hr' && /^\d{4}-\d{2}-\d{2}$/.test(w.gsc.doDatuma), 'svojstvo, servisni račun i datum podataka');
ok(w.zadnjih.klikovi === 120 && w.prethodnih.klikovi === 90 && w.promjene.klikovi === 33 && w.promjene.pozicija === 2.6, `klikovi 28 dana i promjene (+${w.promjene.klikovi} %, pozicija +${w.promjene.pozicija})`);
ok(w.dani.length === 28 && w.dani.every((d) => d.datum >= w.zadnjih.od && d.datum <= w.zadnjih.do), 'graf: 28 dana');
ok(w.upiti[0].kljuc === 'piccolini play' && w.upiti.length === 6, 'upiti poredani po klikovima');
ok(w.upiti.find((x) => x.kljuc === 'banner za krštenje').pomak === 3.6, 'pomak pozicije naspram prethodnih 28 dana');
ok(!/091 234/.test(JSON.stringify(w)), 'upit bez broja telefona');
ok(w.stranice.length === 4 && w.zemlje[0].naziv === 'Hrvatska' && w.zemlje[1].naziv === 'Slovenija', 'stranice i zemlje');
ok(w.indeks.length === 4 && w.indeks.filter((a) => !a.uIndeksu).length === 1 && !w.indeks[0].uIndeksu, 'indeksiranje: jedna adresa nije u indeksu i ide prva');
ok(w.sitemapi.length === 1 && w.sitemapi[0].adresa === 4 && w.sitemapi[0].greske === 0, 'sitemap');
const u = w.uvidi.map((x) => x.tekst).join(' | ');
ok(/120 klikova/.test(u) && /1 od 4 stranica/.test(u) && /„banner za krštenje” je na 13,4\./.test(u) && /„igraonica zagreb”/.test(u) && /Slovenije/.test(u), 'zaključci: klikovi, indeks, druga stranica, nizak CTR, Slovenija');

const st = (await zovi('GET', '/api/stanje')).d;
ok(st.mjesecno.some((m) => m.gscKlikovi > 0 && m.gscPojavljivanja > 0), 'cijeli mjeseci upisani u mjesečne brojke ploče');

const s2 = await zovi('POST', '/api/gsc/osvjezi', {});
ok(s2.status === 200 && s2.d.provjereno === 0, 'druga sinkronizacija: adrese se ne provjeravaju ponovno unutar 20 sati');

await fetch(GSC + '/pokvari', { method: 'POST' });
const s3 = await zovi('POST', '/api/gsc/osvjezi', {});
ok(s3.status === 502 && /ključ servisnog računa/i.test(s3.d.greska), `odbijen ključ: jasna poruka (${s3.d?.greska})`);
w = await web();
ok(w.gsc.greska && w.zadnjih.klikovi === 120 && w.upiti.length === 6, 'greška se vidi na ekranu, stari podaci ostaju');
await fetch(GSC + '/popravi', { method: 'POST' });

await fetch(GSC + '/bez-pristupa', { method: 'POST' });
const s4 = await zovi('POST', '/api/gsc/osvjezi', {});
ok(s4.status === 502 && /ploca@test-projekt\.iam\.gserviceaccount\.com/.test(s4.d.greska) && /Ograničeno/.test(s4.d.greska), 'bez pristupa svojstvu: poruka kaže koji račun dodati');
await fetch(GSC + '/s-pristupom', { method: 'POST' });
ok((await zovi('POST', '/api/gsc/osvjezi', {})).status === 200 && !(await web()).gsc.greska, 'nakon popravka opet radi');

const z = await (await fetch(GSC + '/zahtjevi')).json();
ok(z.zadnji.every((x) => /^(GET|POST) /.test(x)), 'samo GET i POST (čitanje); nikad PUT ni DELETE (slanje ili brisanje sitemapa)');
ok(z.zadnji.every((x) => !/gsc-pristup|access_token|assertion/.test(x)), 'token ide u zaglavlje, ne u adresu');

const tudje = await zovi('POST', '/api/gsc/osvjezi', {}, 'savjetnik@test.hr', 'drugi');
ok(tudje.status === 503, 'drugi zakupac nema Search Console');
const tw = await zovi('GET', '/api/web', undefined, 'savjetnik@test.hr', 'drugi');
ok(tw.status === 200 && !tw.d.gsc.spojeno && !tw.d.zadnjih && tw.d.upiti.length === 0, 'drugi zakupac ne vidi Piccolinijev Search Console');
ok(!/PRIVATE KEY|gsc-pristup/.test(JSON.stringify(w) + tw.t + s1.t), 'ključ i token se nikad ne vraćaju pregledniku');
