// Jedinični testovi poslovne logike (bez servera): node scripts/poslovanje-test.mjs
import {
  norme, povrsinaSlova, normalizirajStavku, potrosnjaStavke, potrosnjaNarudzbe, dopustenPrijelaz,
  stanjeSkladista, kalendarTjedna, upozorenja, ponedjeljak, maskirajStavke,
} from '../packages/poslovanje/index.js';

const ok = (c, m) => { if (!c) { console.error('PAO:', m); process.exitCode = 1; } else console.log('ok  ', m); };
const blizu = (a, b, e = 1e-3) => Math.abs(a - b) < e;
const n = norme();

// norme i površina slova 15 × 15
ok(blizu(povrsinaSlova(n), 0.0771), `slovo 15×15 cm troši ${povrsinaSlova(n).toFixed(4)} m² (17×17×2/0,75)`);
ok(norme([{ kljuc: 'slojevi', vrijednost: 1 }, { kljuc: 'nepoznato', vrijednost: 9 }]).slojevi === 1, 'norma iz baze nadjačava zadanu, nepoznat ključ se ignorira');

// stavka banner
const s = normalizirajStavku({ proizvod: 'banner', tekst: ' lucija ', dezeni: ['d12', 'D12', 'D12', 'D21'], motivi: [{ m: 'srce', dezen: 'D21' }] });
ok(s.tekst === 'LUCIJA' && s.dezeni.join() === 'D12,D12,D12,D21,D21,D21', 'tekst velikim slovima, zadnja tkanina se nastavlja');
const p = potrosnjaStavke(s, n);
ok(blizu(p.po.D12, 3 * 0.07707) && blizu(p.po.D21, 3 * 0.07707 + 0.05227), `tkanine po slovu i motivu (D12 ${p.po.D12}, D21 ${p.po.D21})`);
ok(p.po.perle === 2 && !p.po.masnice, 'perle na krajevima');
// L, I, J, A su uske (1 petlja), U i C po 2, motiv 1 → 4 + 4 + 1 = 9 petlji × 12 cm
ok(blizu(p.po.traka, 1.08), `traka ${p.po.traka} m (9 petlji)`);
ok(blizu(p.po.spaga, (7 * 18 + 60) / 100), `špaga ${p.po.spaga} m`);
ok(p.po.punilo === 100 && p.sati === 1.95, `punilo ${p.po.punilo} g, ${p.sati} h`);
const razmak = potrosnjaStavke(normalizirajStavku({ proizvod: 'banner', tekst: 'SRETAN ROĐENDAN', dezeni: ['D01'], zavrsetak: 'masnice' }), n);
ok(blizu(razmak.po.D01, 14 * 0.07707) && razmak.po.masnice === 1 && blizu(razmak.po.spaga, (15 * 18 + 60) / 100), 'razmak ne troši tkaninu, ali troši špagu; mašnice umjesto perli');
for (const [ulaz, poruka] of [
  [{ proizvod: 'banner', tekst: '', dezeni: ['D01'] }, 'tekst'],
  [{ proizvod: 'banner', tekst: 'EMA', dezeni: [] }, 'tkaninu'],
  [{ proizvod: 'banner', tekst: 'EMA', dezeni: ['D01', 'D02', 'D03', 'D04'] }, 'više tkanina'],
  [{ proizvod: 'kava' }, 'Nepoznat proizvod'],
]) { let g = ''; try { normalizirajStavku(ulaz); } catch (e) { g = e.message; } ok(g.includes(poruka), `odbija: ${poruka}`); }
let g = ''; try { normalizirajStavku({ proizvod: 'banner', tekst: 'EMA', dezeni: ['X99'] }, (d) => d.startsWith('D')); } catch (e) { g = e.message; }
ok(g.includes('Nepoznata tkanina'), 'nepoznata šifra tkanine se odbija');

// narudžba s BoxNow dostavom
const nar = { usluga: 'sivanje', stanje: 'potvrdjeno', dostava: 'boxnow', stavke: [s] };
ok(potrosnjaNarudzbe(nar, n).po['boxnow-s'] === 1, 'BoxNow kutija po pošiljci');

// prijelazi stanja
ok(dopustenPrijelaz('sivanje', 'potvrdjeno', 'u_izradi') && dopustenPrijelaz('sivanje', 'upit', 'potvrdjeno'), 'naprijed i preskakanje');
ok(dopustenPrijelaz('sivanje', 'gotovo', 'u_izradi'), 'jedan korak natrag');
ok(!dopustenPrijelaz('sivanje', 'u_izradi', 'potvrdjeno'), 'izrezana tkanina se ne vraća u potvrđeno');
ok(!dopustenPrijelaz('sivanje', 'isporuceno', 'otkazano') && dopustenPrijelaz('igraonica', 'opcija', 'otkazano'), 'otkazivanje samo prije kraja');
ok(!dopustenPrijelaz('igraonica', 'opcija', 'u_izradi'), 'stanje druge usluge se odbija');

// skladište
const sada = new Date('2026-11-23T10:00:00Z');
const artikli = [
  { id: 'D12', naziv: 'Cvijeće · roza', kategorija: 'tkanina', jedinica: 'm2', prag: 0.5 },
  { id: 'D21', naziv: 'Zvjezdice · mint', kategorija: 'tkanina', jedinica: 'm2', prag: 0.5 },
  { id: 'D01', naziv: 'Tetra', kategorija: 'tkanina', jedinica: 'm2', prag: 0.5 },
];
const kretanja = [
  { artikl_id: 'D12', vrsta: 'ulaz', kolicina: 3, kad: '2026-10-01T10:00:00Z' },
  { artikl_id: 'D12', vrsta: 'inventura', kolicina: 2, kad: '2026-11-01T10:00:00Z' }, // poništava raniji ulaz
  { artikl_id: 'D12', vrsta: 'potrosnja', kolicina: 0.8, kad: '2026-11-10T10:00:00Z' },
  { artikl_id: 'D12', vrsta: 'ulaz', kolicina: 0.5, kad: '2026-11-12T10:00:00Z' },
  { artikl_id: 'D21', vrsta: 'inventura', kolicina: 0.3, kad: '2026-11-20T10:00:00Z' },
];
const sk = stanjeSkladista(artikli, kretanja, [nar], n, sada);
const d12 = sk.find((a) => a.id === 'D12'), d21 = sk.find((a) => a.id === 'D21'), d01 = sk.find((a) => a.id === 'D01');
ok(blizu(d12.stanje, 1.7), `stanje = inventura + ulaz − potrošnja (${d12.stanje})`);
ok(blizu(d12.rezervirano, 0.2312) && blizu(d12.raspolozivo, 1.4688), `potvrđena narudžba rezervira tkaninu (${d12.rezervirano})`);
ok(d12.slova === 19, `D12: još ${d12.slova} slova`);
ok(blizu(d12.tempoTjedno, 0.2) && blizu(d12.tjedana, 7.3, 0.05), `tempo ${d12.tempoTjedno} m²/tj, ${d12.tjedana} tj.`);
ok(d12.status === 'ok', 'D12 dovoljno');
ok(d21.status === 'kriticno' && d21.slova === 0, `D21: nakon rezervacije ostaje manje od jednog slova → kritično (${d21.raspolozivo} m²)`);
ok(d01.status === 'nepoznato', 'bez inventure: nepoznato');

// kalendar
ok(ponedjeljak('2026-11-26') === '2026-11-23' && ponedjeljak('2026-11-29') === '2026-11-23', 'ponedjeljak tjedna');
const narudzbe = [
  { id: 'a', sifra: 'N-0001', opis: 'Banner LUCIJA', usluga: 'sivanje', stanje: 'potvrdjeno', rok: '2026-11-24', izrada: [{ dan: '2026-11-26', sati: 3 }, { dan: '2026-11-23', sati: 1 }], stavke: [s] },
  { id: 'b', sifra: 'N-0002', opis: 'Tiha knjiga', usluga: 'sivanje', stanje: 'u_izradi', rok: '2026-11-30', izrada: [{ dan: '2026-11-26', sati: 3 }], stavke: [] },
  { id: 'c', sifra: 'R-001', opis: 'Rođendan', usluga: 'igraonica', stanje: 'opcija', termin_od: '2026-11-28T10:00', termin_do: '2026-11-28T13:00', opcija_do: '2026-11-24T11:00:00Z' },
  { id: 'd', sifra: 'R-002', opis: 'Rođendan 2', usluga: 'igraonica', stanje: 'potvrdjeno', termin_od: '2026-11-28T16:00' },
  { id: 'e', sifra: 'N-0003', opis: 'Otkazano', usluga: 'sivanje', stanje: 'otkazano', rok: '2026-11-25', izrada: [{ dan: '2026-11-25', sati: 4 }] },
];
const k = kalendarTjedna(narudzbe, '2026-11-25', n);
ok(k.od === '2026-11-23' && k.dani.length === 7, 'tjedan od ponedjeljka');
ok(k.dani[3].sati === 6 && k.dani[3].preko, 'četvrtak 6 h > 5 h: preopterećeno');
ok(k.dani[1].isporuke.length === 1 && k.dani[5].igraonica.length === 2, 'isporuka u utorak, dva termina u subotu');
ok(k.dani[2].izrada.length === 0, 'otkazana narudžba nije na kalendaru');

// upozorenja
const u = upozorenja(narudzbe, sk, n, sada);
const vrste = u.map((x) => x.vrsta);
ok(vrste.includes('opcija') && u.find((x) => x.vrsta === 'opcija').tekst.includes('25 h'), 'opcija ističe za 25 h');
ok(vrste.includes('rok'), 'rok isporuke za 1 dan, a nije gotovo');
ok(vrste.includes('kapacitet') && vrste.includes('sukob'), 'preopterećen dan i dvije rezervacije isti dan');
ok(u.some((x) => x.vrsta === 'skladiste' && x.artikl === 'D21'), 'skladište: D21 kritično');
ok(u[0].razina === 1, 'hitno prvo');
ok(!JSON.stringify(u).includes('@'), 'upozorenja bez e-mail adresa');

// privatnost
ok(maskirajStavke([s])[0].tekst === '••••••' && maskirajStavke([s])[0].dezeni.length === 6, 'nakon isporuke ime se maskira, tkanine ostaju');
