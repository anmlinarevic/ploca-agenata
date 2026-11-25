// Jedinični testovi poslovne logike (bez servera): node scripts/poslovanje-test.mjs
import {
  norme, povrsinaSlova, normalizirajStavku, potrosnjaStavke, potrosnjaNarudzbe, dopustenPrijelaz,
  stanjeSkladista, kalendarTjedna, kalendarMjeseca, upozorenja, ponedjeljak, maskirajStavke, stanjePonude, uslugaPonude,
} from '../packages/poslovanje/index.js';
import { redIzDetalja, ponudaIzReda } from '../packages/poslovanje/parra.js';

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

// mjesečni kalendar
const vel = kalendarMjeseca([], '2026-02-15', n);
ok(vel.od === '2026-01-26' && vel.do === '2026-03-01' && vel.dani.length === 35, `veljača 2026: ${vel.od} – ${vel.do}, ${vel.dani.length} dana`);
ok(vel.dani.filter((d) => !d.izvan).length === 28 && vel.dani[0].izvan, 'dani izvan mjeseca označeni');
const stu = kalendarMjeseca([], '2026-11-24', n);
ok(stu.od === '2026-10-26' && stu.do === '2026-12-06' && stu.dani.length === 42, `studeni 2026: ${stu.dani.length} dana (6 tjedana)`);

// ponude iz Parre
ok(stanjePonude({ status: 'Issued', racuni: [] }) === 'poslana', 'izdana ponuda = poslana');
ok(stanjePonude({ status: 'Accepted', racuni: [] }) === 'prihvacena', 'prihvaćena = rezervirano');
ok(stanjePonude({ status: 'Accepted', racuni: [{ id: 1 }], placeno: 0, za_platiti: 50 }) === 'racun', 'račun izdan, nije plaćen');
ok(stanjePonude({ status: 'Accepted', racuni: [{ id: 1 }], placeno: 20, za_platiti: 50 }) === 'djelomicno', 'djelomično plaćeno');
ok(stanjePonude({ status: 'Accepted', racuni: [{ id: 1 }], placeno: 50, za_platiti: 50 }) === 'placeno', 'plaćeno do kraja');
ok(stanjePonude({ status: 'Accepted', racuni: [{ id: 1, status: 'Cancelled' }] }) === 'prihvacena', 'storniran račun se ne broji');
ok(stanjePonude({ status: 'Denied', racuni: [] }) === 'odbijena', 'odbijena');
ok(uslugaPonude([{ naziv: 'Paket: softplay igraonica i dvije igračke pas skakalica — do 8 sati' }, { naziv: 'Banner „SRETAN ROĐENDAN“' }]) === 'igraonica', 'paket igraonice (i uz banner) = igraonica');
ok(uslugaPonude([{ naziv: 'Prijevoz — dostava i preuzimanje igraonice' }]) === 'igraonica', 'prijevoz = igraonica');
ok(uslugaPonude([{ naziv: 'Rođendanski set: banner „SRETAN ROĐENDAN“ i banner s imenom do 4 slova' }, { naziv: 'Dostava bannera u BoxNow paketomat' }]) === 'sivanje', 'banneri i BoxNow = šivanje');
ok(uslugaPonude([]) === 'sivanje', 'bez stavki = šivanje');
const det = redIzDetalja({ id: 7, status: { name: 'Accepted' }, basicInfo: { offerNumber: '7-1-1', offerDate: '2026-11-20T10:00:00' },
  customer: { name: 'Ana Anić', contactEmail: 'ana@primjer.hr' }, deliveryInfo: { isDeliveryPeriod: true, deliveryDateFrom: '2026-12-01', deliveryDateTo: '2026-12-03', deliveryAddress: 'Ulica 1' },
  offerLines: [{ name: 'Banner s imenom, po slovu', quantity: 6, unitOfMeasureMark: 'H87', description: 'LUCIJA, roza' }], totalAmount: 90, invoices: [] });
ok(det.isporuka_od === '2026-12-01' && det.isporuka_do === '2026-12-03' && det.stavke[0].kolicina === 6, 'detalj: razdoblje isporuke i stavke');
ok(!/Ana|ana@|Ulica|LUCIJA/.test(JSON.stringify(det)), 'detalj bez imena kupca, e-maila, adrese i opisa stavke');
const pk = kalendarTjedna([], '2026-12-01', n, [ponudaIzReda({ ...det, stavke_json: JSON.stringify(det.stavke), racuni_json: '[]' })]);
ok(['2026-12-01', '2026-12-02', '2026-12-03'].every((d) => pk.dani.find((x) => x.datum === d).ponude.length === 1) && pk.dani.find((x) => x.datum === '2026-12-04').ponude.length === 0, 'ponuda s razdobljem na svim danima razdoblja');
const up = upozorenja([], [], n, new Date('2026-12-10T10:00:00Z'), [{ id: 1, broj: '1-1-1', stanje: 'racun', isporuka_od: '2026-12-05', isporuka_do: '2026-12-05' }]);
ok(up.some((x) => x.vrsta === 'naplata'), 'upozorenje: isporučeno, račun nije plaćen');

// ---- Meta: izračun za ekran Mreže ----
const { cistiOpis, izracunajKanal } = await import('../packages/poslovanje/meta.js');
ok(cistiOpis('Piši @ana.kupac ili 091 234 5678, ana@primjer.hr') === 'Piši @… ili …, …', 'opis objave bez @oznake, telefona i e-maila');
ok(cistiOpis('') === null, 'prazan opis = null');
const obj = (dana, pregledi, vrsta = 'slika', spremanja = 0) => ({ id: String(dana), vrsta, pregledi, spremanja, opis: 'o' + dana,
  objavljeno: new Date(Date.parse('2026-11-25T19:00:00Z') - dana * 86400000).toISOString() });
const kk = izracunajKanal({ danas: '2026-11-25', objave: [obj(70, 100), obj(63, 120), obj(56, 110), obj(49, 90), obj(42, 100), obj(35, 300, 'reel', 4), obj(28, 320, 'reel'), obj(21, 310, 'reel', 9), obj(14, 140), obj(7, 330, 'reel'), obj(1, null)],
  pratitelji: [{ datum: '2026-10-27', pratitelji: 1000 }, { datum: '2026-11-25', pratitelji: 1040 }], razdoblja: { zadnjih: { doseg: 1200 }, prethodnih: { doseg: 1000 } } });
ok(kk.graf.length === 10 && kk.prosjekPrethodnih5 === 104 && kk.prosjekZadnjih5 === 280 && kk.promjena5 === 169, 'zadnjih 5 naspram prethodnih 5 (objava bez brojki se ne broji)');
ok(kk.pratiteljiRast === 40 && kk.pratiteljiOd === '2026-10-27' && kk.dosegPromjena === 20, 'rast pratitelja u 30 dana i promjena dosega');
ok(kk.najbolje && kk.najbolje.sat === 4 && kk.najbolje.objava >= 2, 'najbolje polje: 20 h, barem 2 objave');
ok(kk.uvidi.some((u) => /Reelsi imaju prosječno 2,9 puta više pregleda od fotografija/.test(u.tekst)), 'uvid: reelsi naspram fotografija');
ok(kk.kadObjaviti.uzorak === 10 && kk.kadObjaviti.sat.indeks === 4 && kk.kadObjaviti.sat.medijan === 130 && kk.kadObjaviti.dan.indeks === 2, 'kad objaviti: sat i dan po medijanu, uzorak 10');
ok(kk.uvidi.some((u) => /Objave oko 20 h imaju najviše pregleda \(medijan 130, 10 objava\)/.test(u.tekst)) && kk.uvidi.some((u) => /Najbolji dan je srijeda \(medijan 130 pregleda, 10 objava\)/.test(u.tekst)), 'uvid: sat i dan, množina');
// Slučaj s ploče: polja s jednom objavom (viralna) ne smiju ni odlučiti ni nestati, a slabo polje s 2 objave nije „najbolje”
const pov = (iso, pregledi) => ({ id: iso, vrsta: 'reel', pregledi, spremanja: 0, opis: 'x', objavljeno: iso });
const ned = izracunajKanal({ danas: '2026-11-25', objave: [
  pov('2026-11-22T10:00:00Z', 500), pov('2026-11-15T10:00:00Z', 520), pov('2026-11-08T10:00:00Z', 480), pov('2026-11-01T10:00:00Z', 510), pov('2026-10-18T10:00:00Z', 490),
  pov('2026-11-19T19:00:00Z', 4600), pov('2026-11-17T16:00:00Z', 200), pov('2026-11-10T16:00:00Z', 234)] });
ok(ned.kadObjaviti.sat.indeks === 1 && ned.kadObjaviti.dan.indeks === 6 && ned.kadObjaviti.dan.objava === 5, 'nedjelja u 11 h (5 objava) je najbolja po satu i danu');
ok(ned.kadObjaviti.jedna.dan === 3 && ned.kadObjaviti.jedna.sat === 4 && ned.kadObjaviti.jedna.pregledi === 4600, 'najjača pojedinačna objava je izdvojena, ne računa se kao obrazac');
ok(ned.najbolje.dan === 6 && ned.najbolje.sat === 1, 'uokvireno polje: nedjelja 11 h, ne utorak 17 h s 2 slabe objave');
ok(izracunajKanal({ danas: '2026-11-25', objave: [pov('2026-11-22T10:00:00Z', 500), pov('2026-11-15T10:00:00Z', 520)] }).kadObjaviti.sat === null, 'premalo objava: nema preporuke po satu');
ok(izracunajKanal({ danas: '2026-11-25' }).uvidi.length === 0 && izracunajKanal({ danas: '2026-11-25' }).najbolje === null, 'bez objava: bez uvida i preporuke');

// ---- Financije: prihod po mjesecu isporuke, naplata, čeka uplatu ----
const { izracunajFinancije, mjeseci: mjeseciFin } = await import('../packages/poslovanje/financije.js');
ok(mjeseciFin('2026-11-25', 6).join(',') === '2026-06,2026-07,2026-08,2026-09,2026-10,2026-11', 'zadnjih 6 mjeseci');
const fin = izracunajFinancije([
  { stanje: 'placeno', iznos: 64, placeno: 64, za_platiti: 64, racuni: [{ id: 1 }], isporuka_od: '2026-11-05', usluga: 'sivanje' },
  { stanje: 'racun', iznos: 40, placeno: 0, za_platiti: 40, racuni: [{ id: 2 }], isporuka_od: '2026-11-20', usluga: 'sivanje' },
  { stanje: 'prihvacena', iznos: 180, racuni: [], isporuka_od: '2026-11-10', isporuka_do: '2026-11-11', usluga: 'igraonica' },
  { stanje: 'prihvacena', iznos: 90, racuni: [], isporuka_od: '2026-12-06', usluga: 'igraonica' },
  { stanje: 'poslana', iznos: 500, racuni: [], isporuka_od: '2026-11-15', usluga: 'sivanje' },
  { stanje: 'placeno', iznos: 100, placeno: 100, za_platiti: 100, racuni: [{ id: 3 }], isporuka_od: '2026-10-12', usluga: 'sivanje' },
], [{ mjesec: '2026-11', usd: 1.234 }], '2026-11-25');
ok(fin.ovaj.prihod === 284 && fin.ovaj.naplaceno === 64 && fin.ovaj.sivanje === 104 && fin.ovaj.igraonica === 180, 'studeni: prihod bez poslanih ponuda, po usluzi');
ok(fin.promjena === 184 && fin.prosli.prihod === 100, 'promjena naspram listopada');
ok(fin.cekaUplatu === 40 && fin.racunaOtvoreno === 1 && fin.bezRacuna === 1 && fin.bezRacunaIznos === 180, 'čeka uplatu i isporučeno bez računa');
ok(fin.ovaj.agenti === 1.23 && fin.mjeseci.length === 6, 'trošak agenata po mjesecu');
