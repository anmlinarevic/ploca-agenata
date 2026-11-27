// Search Console po razdoblju: godina dnevnih brojki, zbrojevi i usporedba za bilo koje razdoblje, popisi iz Googlea s predmemorijom.
// Bez wranglera: prave migracije na SQLite bazi, lažni Google (prijava, Search Analytics). Upotreba: node scripts/gsc-razdoblje-test.mjs
import { generateKeyPairSync } from 'node:crypto';
import { d1, nova } from './d1-sqlite.mjs';
import { sinkronizirajGsc, pregledWeba, razdobljeWeba } from '../packages/poslovanje/gsc.js';

let pali = 0;
const ok = (c, m) => { if (!c) { console.error('PAO:', m); pali++; process.exitCode = 1; } else console.log('ok  ', m); };
const baca = (f, re, m) => { try { f(); ok(false, `${m} (nije bacilo grešku)`); } catch (e) { ok(re.test(e.message), `${m} (${e.message})`); } };

const par = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const kljuc = { type: 'service_account', client_email: 'ploca@test.iam.gserviceaccount.com', private_key: par.privateKey };
const sada = new Date('2026-11-25T10:00:00Z');
const DAN = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const KRAJ = iso(sada.getTime() - 3 * DAN);                         // zadnji dan s konačnim brojkama: 22. 11.
const dodaj = (d, k) => iso(Date.parse(`${d}T12:00:00Z`) + k * DAN);
const idx = (d) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${KRAJ}T12:00:00Z`)) / DAN); // 0 = kraj, negativno unazad
const klikova = (d) => Math.max(0, Math.round(40 + idx(d) / 8 + (new Date(`${d}T12:00:00Z`).getUTCDay() === 6 ? -10 : 0))); // raste prema kraju
const pojava = (d) => klikova(d) * 30;
const pozicija = (d) => Math.round((9 - idx(d) / 60) * 10) / 10;
const raspon = (od, doD) => { const l = []; for (let d = od; d <= doD; d = dodaj(d, 1)) l.push(d); return l; };

function laznaGoogle() {
  const st = { zahtjeva: 0, popisi: 0, kvar: false };
  const odg = (status, tijelo) => ({ ok: status < 400, status, json: async () => tijelo, text: async () => '' });
  const UPITI = [['ručno šivani banner', .4], ['girlanda s imenom', .3], ['najam igraonice dugo selo', .2], ['banner za krštenje', .1]];
  const fetchFn = async (url, opts = {}) => {
    st.zahtjeva++;
    if (url.startsWith('http://tok/')) return odg(200, { access_token: 'test-token' });
    const u = new URL(url), put = u.pathname;
    if (/\/searchAnalytics\/query$/.test(put)) {
      const b = JSON.parse(opts.body), dims = b.dimensions || [], dani = raspon(b.startDate, b.endDate);
      if (dims.length && dims[0] !== 'date') {
        st.popisi++;
        if (st.kvar) return odg(403, { error: { message: 'Forbidden' } });
      }
      const ukupnoK = dani.reduce((s, d) => s + klikova(d), 0), ukupnoP = dani.reduce((s, d) => s + pojava(d), 0);
      if (!dims.length) return odg(200, { rows: [{ clicks: ukupnoK, impressions: ukupnoP, ctr: ukupnoP ? ukupnoK / ukupnoP : 0, position: 9 }] });
      if (dims[0] === 'date') return odg(200, { rows: dani.map((d) => ({ keys: [d], clicks: klikova(d), impressions: pojava(d), ctr: 1 / 30, position: pozicija(d) })) });
      const kljucevi = dims[0] === 'query' ? UPITI : dims[0] === 'page' ? [['https://www.piccoliniplay.hr/banneri', .6], ['https://www.piccoliniplay.hr/softplay', .4]] : [['hrv', .9], ['svn', .1]];
      return odg(200, { rows: kljucevi.map(([k, udio]) => ({ keys: [k], clicks: Math.round(ukupnoK * udio), impressions: Math.round(ukupnoP * udio), ctr: 1 / 30, position: 8 })) });
    }
    if (/\/sitemaps$/.test(put)) return odg(200, {});
    if (/\/webmasters\/v3\/sites\/[^/]+$/.test(put)) return odg(200, { permissionLevel: 'siteFullUser' });
    return odg(404, { error: { message: `nepoznato ${put}` } });
  };
  return { fetchFn, st };
}

const db = nova(); const g = laznaGoogle();
const E = { DB: d1(db), GSC_KLJUC: JSON.stringify(kljuc), GSC_SVOJSTVO: 'sc-domain:piccoliniplay.hr', GSC_API_URL: 'http://api', GSC_TOKEN_URL: 'http://tok/token', GSC_ZAKUPAC: 't1' };

// ---- razdoblje iz upita ----
let r = razdobljeWeba({}, KRAJ); ok(r.dana === 28 && r.do === KRAJ, 'zadano 28 dana do zadnjeg dana s konačnim brojkama');
r = razdobljeWeba({ dana: '1' }, KRAJ); ok(r.od === KRAJ && r.do === KRAJ, '1 dan = zadnji dan s konačnim brojkama (ne jučer: Google kasni)');
r = razdobljeWeba({ od: '2026-09-01', do: '2026-10-31' }, KRAJ); ok(r.dana === 61, 'prilagođeno od-do');
baca(() => razdobljeWeba({ dana: '0' }, KRAJ), /1 do 366/, 'nula dana');
baca(() => razdobljeWeba({ od: '2026-10-01', do: '2026-11-24' }, KRAJ), /konačne brojke do 2026-11-22/, 'kraj nakon zadnjeg konačnog dana');
baca(() => razdobljeWeba({ od: '2025-01-01', do: '2026-11-20' }, KRAJ), /najviše 366/, 'predugo');
baca(() => razdobljeWeba({ od: '2026-9-1', do: '2026-10-01' }, KRAJ), /YYYY-MM-DD/, 'neispravan datum');

// ---- sinkronizacija: godina dnevnih brojki ----
const s = await sinkronizirajGsc(E, 't1', { fetchFn: g.fetchFn, sada: () => sada });
ok(s.ok, `sinkronizacija uspjela${s.ok ? '' : ` (${s.greska})`}`);
const dani = db.prepare(`SELECT MIN(datum) AS od, MAX(datum) AS do, COUNT(*) AS n FROM gsc_dani`).get();
ok(dani.n === 365 && dani.od === dodaj(KRAJ, -364) && dani.do === KRAJ, `365 dnevnih redova (${dani.od} do ${dani.do})`);
const mj = db.prepare(`SELECT mjesec FROM mjesecno ORDER BY mjesec`).all().map((x) => x.mjesec);
ok(!mj.includes(KRAJ.slice(0, 7)) && !mj.includes(dodaj(KRAJ, -364).slice(0, 7)), `mjesečni zbrojevi samo za cijele mjesece (${mj[0]} do ${mj[mj.length - 1]})`);
// zapis starije od 120 dana mora preživjeti sljedeću sinkronizaciju (prije se brisalo)
db.prepare(`INSERT OR REPLACE INTO gsc_dani (tenant_id, datum, klikovi, pojavljivanja) VALUES ('t1', ?, 7, 70)`).run(dodaj(KRAJ, -380));
db.prepare(`INSERT OR REPLACE INTO gsc_dani (tenant_id, datum, klikovi, pojavljivanja) VALUES ('t1', ?, 7, 70)`).run(dodaj(KRAJ, -420));
await sinkronizirajGsc(E, 't1', { fetchFn: g.fetchFn, sada: () => sada });
ok(db.prepare(`SELECT COUNT(*) AS n FROM gsc_dani WHERE datum = ?`).get(dodaj(KRAJ, -380)).n === 1 && db.prepare(`SELECT COUNT(*) AS n FROM gsc_dani WHERE datum = ?`).get(dodaj(KRAJ, -420)).n === 0, 'dnevne brojke se čuvaju 400 dana, starije se brišu');
db.prepare(`DELETE FROM gsc_dani WHERE datum < ?`).run(dodaj(KRAJ, -364));

// ---- ekran bez upita: kao do sada ----
let w = await pregledWeba(E, 't1', sada);
ok(w.zadnjih && w.zadnjih.klikovi > 0 && w.razdoblje === undefined && w.upiti.length === 4, 'bez razdoblja: zadnjih 28 dana iz sinkronizacije, kao prije');
ok(/u 28 dana donio/.test(w.uvidi[0].tekst), 'uvid kaže „u 28 dana”');

// ---- 90 dana ----
g.st.zahtjeva = 0; g.st.popisi = 0;
w = await pregledWeba(E, 't1', sada, { dana: '90' }, { fetchFn: g.fetchFn });
const ocek = raspon(dodaj(KRAJ, -89), KRAJ).reduce((x, d) => x + klikova(d), 0), pret = raspon(dodaj(KRAJ, -179), dodaj(KRAJ, -90)).reduce((x, d) => x + klikova(d), 0);
ok(w.zadnjih.klikovi === ocek && w.zadnjih.od === dodaj(KRAJ, -89) && w.razdoblje.dana === 90 && w.razdoblje.pokriveno === 90, `zbroj klikova za 90 dana iz dnevnih brojki (${ocek})`);
ok(w.prethodnih && w.prethodnih.klikovi === pret && w.promjene.klikovi === Math.round((ocek - pret) / pret * 100), `usporedba s prethodnih 90 dana (${w.promjene.klikovi} %)`);
ok(w.dani.length === 90 && w.dani[0].datum === dodaj(KRAJ, -89), 'graf: 90 dnevnih redova');
ok(w.razdoblje.popisi.tocno && w.razdoblje.popisi.izvor === 'zivo' && g.st.popisi === 6, 'popisi dohvaćeni iz Googlea (3 vrste, razdoblje i prethodno)');
ok(w.upiti[0].kljuc === 'ručno šivani banner' && w.upiti[0].klikoviPrije > 0 && w.zemlje[0].naziv === 'Hrvatska', 'popis upita i zemalja za razdoblje, s brojkama prethodnog');
ok(/razdoblju od 90 dana/.test(w.uvidi[0].tekst) && /prethodnog razdoblja/.test(w.uvidi[0].tekst), 'uvid kaže „razdoblju od 90 dana”');
const zah = g.st.zahtjeva;
w = await pregledWeba(E, 't1', sada, { dana: '90' }, { fetchFn: g.fetchFn });
ok(w.razdoblje.popisi.izvor === 'predmemorija' && g.st.zahtjeva === zah, 'drugi put: popisi iz predmemorije, bez novih zahtjeva Googleu');
w = await pregledWeba(E, 't1', new Date(sada.getTime() + 13 * 3600000), { dana: '90' }, { fetchFn: g.fetchFn });
ok(w.razdoblje.popisi.izvor === 'zivo', 'nakon 12 sati popisi se ponovno dohvaćaju');

// ---- godina, jedan dan, prilagođeno ----
w = await pregledWeba(E, 't1', sada, { dana: '365' }, { fetchFn: g.fetchFn });
ok(w.razdoblje.dana === 365 && w.razdoblje.pokriveno === 365 && w.prethodnih === null && w.razdoblje.prethodno === null, 'godina dana: nema usporedbe jer prethodno razdoblje izlazi iz povijesti');
w = await pregledWeba(E, 't1', sada, { dana: '1' }, { fetchFn: g.fetchFn });
ok(w.zadnjih.klikovi === klikova(KRAJ) && w.razdoblje.dana === 1 && w.prethodnih.klikovi === klikova(dodaj(KRAJ, -1)), '1 dan: klikovi zadnjeg konačnog dana, usporedba s prethodnim danom');
w = await pregledWeba(E, 't1', sada, { od: '2026-03-01', do: '2026-05-31' }, { fetchFn: g.fetchFn });
ok(w.zadnjih.klikovi === raspon('2026-03-01', '2026-05-31').reduce((x, d) => x + klikova(d), 0) && w.razdoblje.dana === 92, 'prilagođeno od-do');

// ---- kvarovi ----
g.st.kvar = true;
w = await pregledWeba(E, 't1', sada, { od: '2026-02-01', do: '2026-02-28' }, { fetchFn: g.fetchFn });
ok(w.zadnjih.klikovi > 0 && w.razdoblje.popisi.tocno === false && /pristup/i.test(w.razdoblje.popisi.greska), 'Google odbija popise: brojke razdoblja ostaju, popisi su označeni kao netočni za razdoblje');
ok(w.upiti.length === 4, 'umjesto popisa za razdoblje ostaju popisi zadnjih 28 dana');
g.st.kvar = false;
const E2 = { ...E, GSC_KLJUC: undefined };
w = await pregledWeba(E2, 't1', sada, { dana: '28' }, { fetchFn: g.fetchFn });
ok(w.zadnjih.klikovi > 0 && w.razdoblje.popisi.tocno === false && /nije spojen/.test(w.razdoblje.popisi.greska), 'bez ključa: brojke iz baze rade, popisi javljaju da Search Console nije spojen');
w = await pregledWeba({ DB: d1(db) }, 't2', sada, { dana: '28' }, { fetchFn: g.fetchFn });
ok(w.zadnjih.klikovi === 0 && w.prethodnih === null, 'drugi zakupac ne vidi tuđe brojke');
await pregledWeba(E, 't1', sada, { dana: 'x' }).then(() => ok(false, 'neispravan upit'), (e) => ok(/1 do 366/.test(e.message), 'neispravan upit iz API-ja'));
console.log(pali ? `\n${pali} provjera nije prošlo` : '\nSve provjere su prošle');
