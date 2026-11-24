/* Poslovna logika faze B: narudžbe, potrošnja materijala, stanje skladišta, kalendar i upozorenja.
 * Čiste funkcije bez baze: isti kod koriste dashboard, MCP i testovi. Iznosi su u jedinici artikla (m², m, kom, g, par). */

// ---------- norme ----------
// Slovo 15 × 15 cm (vlasnik, 23. 11. 2026.). Ostalo je procjena dok se ne izmjeri: mijenja se na ploči (tablica norme).
export const ZADANE_NORME = {
  slovo_sirina_cm: 15,
  slovo_visina_cm: 15,
  motiv_sirina_cm: 12,
  motiv_visina_cm: 12,
  sav_cm: 1,                 // dodatak za šav sa svake strane
  slojevi: 2,                // lice i naličje iz iste tkanine
  iskoristivost: 0.75,       // koliko tkanine ostaje u krojevima, ostalo je otpad
  traka_cm_po_petlji: 12,
  spaga_cm_po_znaku: 18,     // razmak između slova na špagi, i za razmak u tekstu
  spaga_krajevi_cm: 60,      // oba kraja zajedno
  punilo_g_po_slovu: 15,
  punilo_g_po_motivu: 10,
  sati_banner: 0.25,         // krojenje špage, završetak, pakiranje
  sati_po_slovu: 0.25,
  sati_po_motivu: 0.2,
  kapacitet_sati_dan: 5,
  dani_upozorenja_rok: 2,
};
export const OPIS_NORMI = {
  slovo_sirina_cm: 'Širina slova (cm)', slovo_visina_cm: 'Visina slova (cm)',
  motiv_sirina_cm: 'Širina motiva (cm)', motiv_visina_cm: 'Visina motiva (cm)',
  sav_cm: 'Dodatak za šav, sa svake strane (cm)', slojevi: 'Slojevi tkanine po slovu',
  iskoristivost: 'Iskoristivost krojenja (0–1)', traka_cm_po_petlji: 'Traka po petlji (cm)',
  spaga_cm_po_znaku: 'Špaga po znaku (cm)', spaga_krajevi_cm: 'Špaga za krajeve (cm)',
  punilo_g_po_slovu: 'Punilo po slovu (g)', punilo_g_po_motivu: 'Punilo po motivu (g)',
  sati_banner: 'Sati po banneru, osnovno', sati_po_slovu: 'Sati po slovu', sati_po_motivu: 'Sati po motivu',
  kapacitet_sati_dan: 'Kapacitet šivanja (sati na dan)', dani_upozorenja_rok: 'Upozori na rok (dana prije)',
};
export const norme = (redovi = []) => {
  const n = { ...ZADANE_NORME };
  for (const r of redovi) if (r.kljuc in n && Number.isFinite(+r.vrijednost)) n[r.kljuc] = +r.vrijednost;
  return n;
};

// ---------- stanja narudžbi ----------
export const STANJA = {
  sivanje: ['upit', 'ponuda', 'potvrdjeno', 'u_izradi', 'gotovo', 'isporuceno'],
  igraonica: ['upit', 'opcija', 'potvrdjeno', 'odradjeno'],
};
export const NAZIV_STANJA = {
  upit: 'Upit', ponuda: 'Ponuda', potvrdjeno: 'Potvrđeno', u_izradi: 'U izradi', gotovo: 'Gotovo',
  isporuceno: 'Isporučeno', opcija: 'Opcija', odradjeno: 'Odrađeno', otkazano: 'Otkazano',
};
const ZAVRSNA = new Set(['isporuceno', 'odradjeno', 'otkazano']);
// Stanja u kojima je tkanina izrezana (potrošnja se knjiži pri ulasku u prvo od njih).
const IZREZANO = new Set(['u_izradi', 'gotovo', 'isporuceno']);

/** Dopušteno: korak naprijed (i preskakanje), jedan korak natrag, otkazivanje dok nije završeno. */
export function dopustenPrijelaz(usluga, iz, u) {
  if (iz === u) return false;
  if (u === 'otkazano') return !ZAVRSNA.has(iz);
  if (iz === 'otkazano') return false;
  const red = STANJA[usluga];
  const a = red.indexOf(iz), b = red.indexOf(u);
  if (a < 0 || b < 0) return false;
  if (ZAVRSNA.has(iz)) return false;
  if (b < a && IZREZANO.has(iz) && !IZREZANO.has(u)) return false; // izrezana tkanina se ne vraća u „potvrđeno”
  return b > a || b === a - 1;
}
export const trebaKnjizitiPotrosnju = (usluga, u) => usluga === 'sivanje' && IZREZANO.has(u);
export const jeAktivna = (n) => !ZAVRSNA.has(n.stanje);

// ---------- potrošnja ----------
const USKA = new Set(['A', 'I', 'J', 'L', '1', '4', '!', '?', '.', "'", '-', '&']); // jedna petlja trake (kao na stranici)
const zaokruzi = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
export const povrsinaSlova = (n) =>
  ((n.slovo_sirina_cm + 2 * n.sav_cm) * (n.slovo_visina_cm + 2 * n.sav_cm) * n.slojevi) / n.iskoristivost / 10000;
export const povrsinaMotiva = (n) =>
  ((n.motiv_sirina_cm + 2 * n.sav_cm) * (n.motiv_visina_cm + 2 * n.sav_cm) * n.slojevi) / n.iskoristivost / 10000;

/** Provjera i čišćenje stavke iz zahtjeva. Baca Error s porukom za korisnika. */
export function normalizirajStavku(s, dezeniPostoje = () => true) {
  if (!s || typeof s !== 'object') throw new Error('Stavka nije ispravna');
  if (s.proizvod === 'banner') {
    const tekst = String(s.tekst ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (!tekst) throw new Error('Banner: upiši tekst');
    if (tekst.length > 40) throw new Error('Banner: najviše 40 znakova');
    const znakova = tekst.replace(/ /g, '').length;
    const ulaz = Array.isArray(s.dezeni) ? s.dezeni.map((d) => String(d).trim().toUpperCase()).filter(Boolean) : [];
    if (!ulaz.length) throw new Error('Banner: odaberi barem jednu tkaninu');
    if (ulaz.length > znakova) throw new Error('Banner: više tkanina nego slova');
    const dezeni = Array.from({ length: znakova }, (_, i) => ulaz[Math.min(i, ulaz.length - 1)]); // novo slovo nosi tkaninu prethodnog
    const motivi = (Array.isArray(s.motivi) ? s.motivi : []).slice(0, 10).map((m) => ({
      m: String(m?.m ?? 'motiv').slice(0, 30), dezen: String(m?.dezen ?? '').trim().toUpperCase(),
    }));
    for (const d of [...dezeni, ...motivi.map((m) => m.dezen)]) if (!dezeniPostoje(d)) throw new Error(`Nepoznata tkanina: ${d || '(prazno)'}`);
    const zavrsetak = s.zavrsetak === 'masnice' ? 'masnice' : 'perle';
    return { proizvod: 'banner', tekst, dezeni, motivi, zavrsetak };
  }
  if (s.proizvod === 'ostalo') {
    const opis = String(s.opis ?? '').trim().slice(0, 200);
    if (!opis) throw new Error('Stavka: upiši opis');
    const sati = Number.isFinite(+s.sati) && +s.sati >= 0 && +s.sati <= 100 ? +s.sati : 0;
    const potrosnja = (Array.isArray(s.potrosnja) ? s.potrosnja : []).slice(0, 20).map((p) => ({ artikl: String(p.artikl), kolicina: +p.kolicina }))
      .filter((p) => p.artikl && Number.isFinite(p.kolicina) && p.kolicina > 0);
    return { proizvod: 'ostalo', opis, sati, potrosnja };
  }
  throw new Error('Nepoznat proizvod (banner ili ostalo)');
}

/** Potrošnja jedne stavke: { po: {artiklId: količina}, sati, slova, motivi }. */
export function potrosnjaStavke(s, n) {
  const po = {};
  const dodaj = (a, k) => { if (k > 0) po[a] = zaokruzi((po[a] || 0) + k); };
  if (s.proizvod === 'ostalo') {
    for (const p of s.potrosnja) dodaj(p.artikl, p.kolicina);
    return { po, sati: s.sati, slova: 0, motivi: 0 };
  }
  const znakovi = s.tekst.replace(/ /g, '').split('');
  const razmaka = (s.tekst.match(/ /g) || []).length;
  const ps = povrsinaSlova(n), pm = povrsinaMotiva(n);
  znakovi.forEach((c, i) => dodaj(s.dezeni[i], ps));
  s.motivi.forEach((m) => dodaj(m.dezen, pm));
  const petlji = znakovi.reduce((a, c) => a + (USKA.has(c) ? 1 : 2), 0) + s.motivi.length;
  dodaj('traka', (petlji * n.traka_cm_po_petlji) / 100);
  dodaj('spaga', ((znakovi.length + razmaka + s.motivi.length) * n.spaga_cm_po_znaku + n.spaga_krajevi_cm) / 100);
  dodaj('punilo', znakovi.length * n.punilo_g_po_slovu + s.motivi.length * n.punilo_g_po_motivu);
  if (s.zavrsetak === 'perle') dodaj('perle', 2); else dodaj('masnice', 1);
  const sati = n.sati_banner + znakovi.length * n.sati_po_slovu + s.motivi.length * n.sati_po_motivu;
  return { po, sati: zaokruzi(sati, 2), slova: znakovi.length, motivi: s.motivi.length };
}

export function potrosnjaNarudzbe(narudzba, n) {
  const po = {};
  let sati = 0, slova = 0;
  for (const s of narudzba.stavke || []) {
    const p = potrosnjaStavke(s, n);
    for (const [a, k] of Object.entries(p.po)) po[a] = zaokruzi((po[a] || 0) + k);
    sati += p.sati; slova += p.slova;
  }
  if (narudzba.dostava === 'boxnow') po['boxnow-s'] = (po['boxnow-s'] || 0) + 1;
  return { po, sati: zaokruzi(sati, 2), slova };
}

// ---------- skladište ----------
const DAN = 86400000;
/**
 * artikli: redovi tablice; kretanja: redovi (bilo kojim redom); narudzbe: s parsiranim stavkama.
 * Vraća artikle s izračunom: stanje, rezervirano, raspolozivo, tempoTjedno, tjedana, slova (tkanine), status.
 */
export function stanjeSkladista(artikli, kretanja, narudzbe, n, sada = new Date()) {
  const po = new Map(artikli.map((a) => [a.id, { stanje: 0, imaPodatke: false, inventura: null, potroseno28: 0 }]));
  const sortirano = [...kretanja].sort((a, b) => (a.kad < b.kad ? -1 : a.kad > b.kad ? 1 : 0));
  const granica = new Date(sada.getTime() - 28 * DAN).toISOString();
  for (const k of sortirano) {
    const x = po.get(k.artikl_id);
    if (!x) continue;
    x.imaPodatke = true;
    if (k.vrsta === 'inventura') { x.stanje = k.kolicina; x.inventura = k.kad; }
    else if (k.vrsta === 'ulaz' || k.vrsta === 'povrat') x.stanje += k.kolicina;
    else { x.stanje -= k.kolicina; if (k.vrsta === 'potrosnja' && k.kad >= granica) x.potroseno28 += k.kolicina; }
  }
  // Rezervirano: potvrđene narudžbe kojima tkanina još nije izrezana.
  const rez = {};
  for (const nar of narudzbe) {
    if (nar.usluga !== 'sivanje' || !['potvrdjeno'].includes(nar.stanje)) continue;
    for (const [a, k] of Object.entries(potrosnjaNarudzbe(nar, n).po)) rez[a] = (rez[a] || 0) + k;
  }
  const ps = povrsinaSlova(n);
  return artikli.map((a) => {
    const x = po.get(a.id);
    const rezervirano = zaokruzi(rez[a.id] || 0);
    const stanje = zaokruzi(x.stanje);
    const raspolozivo = zaokruzi(stanje - rezervirano);
    const tempoTjedno = zaokruzi(x.potroseno28 / 4);
    const tjedana = tempoTjedno > 0 ? zaokruzi(Math.max(0, raspolozivo) / tempoTjedno, 1) : null;
    let status;
    if (!x.imaPodatke) status = rezervirano > 0 ? 'kriticno' : 'nepoznato';
    else if ((raspolozivo <= 0 || (a.kategorija === 'tkanina' && raspolozivo < ps)) && (rezervirano > 0 || tempoTjedno > 0)) status = 'kriticno';
    else if (a.prag != null && raspolozivo < a.prag && tjedana != null && tjedana < 2) status = 'kriticno';
    else if ((a.prag != null && raspolozivo < a.prag) || (tjedana != null && tjedana < 4)) status = 'uskoro';
    else status = 'ok';
    const staraInventura = x.inventura ? (sada - new Date(x.inventura)) / DAN > 30 : x.imaPodatke;
    return {
      ...a, stanje, rezervirano, raspolozivo, tempoTjedno, tjedana, status,
      inventura: x.inventura, staraInventura: !!(staraInventura && tempoTjedno > 0),
      slova: a.kategorija === 'tkanina' ? Math.max(0, Math.floor(raspolozivo / ps)) : null,
    };
  });
}

// ---------- kalendar ----------
/** Datum u Zagrebu (YYYY-MM-DD) za trenutak. */
export const datumZagreb = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const dodajDane = (datum, k) => {
  const d = new Date(datum + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
/** Lokalno vrijeme u Zagrebu („2026-11-28T10:00”) → UTC ISO. Workers rade u UTC-u. */
export function zagrebUUtc(lokalno) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(lokalno || '');
  if (!m) return null;
  const kaoUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const dijelovi = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(kaoUtc)).map((p) => [p.type, p.value]));
  const pomak = Date.UTC(+dijelovi.year, +dijelovi.month - 1, +dijelovi.day, +dijelovi.hour, +dijelovi.minute) - kaoUtc;
  return new Date(kaoUtc - pomak).toISOString();
}
export const ponedjeljak = (datum) => {
  const d = new Date(datum + 'T12:00:00Z');
  return dodajDane(datum, -((d.getUTCDay() + 6) % 7));
};

// ---------- ponude iz Parre ----------
/** Stanje ponude za kalendar: poslana → prihvaćena (datum rezerviran) → račun → djelomično plaćeno → plaćeno. */
export function stanjePonude(p) {
  if (p.status === 'Denied') return 'odbijena';
  if (p.status === 'Expired') return 'istekla';
  const racuni = (p.racuni || []).filter((r) => !/cancel|storn/i.test(r.status || ''));
  if (racuni.length) {
    if (p.za_platiti > 0 && (p.placeno ?? 0) >= p.za_platiti - 0.005) return 'placeno';
    if (racuni.some((r) => r.status === 'Paid') && p.placeno == null) return 'placeno';
    if ((p.placeno ?? 0) > 0) return 'djelomicno';
    return 'racun';
  }
  return p.status === 'Accepted' ? 'prihvacena' : 'poslana';
}
export const NAZIV_PONUDE = {
  poslana: 'Ponuda poslana', prihvacena: 'Prihvaćena · rezervirano', racun: 'Račun izdan, čeka uplatu',
  djelomicno: 'Djelomično plaćeno', placeno: 'Plaćeno', odbijena: 'Odbijena', istekla: 'Istekla',
};
const ponudaUKalendaru = (p) => !['odbijena', 'istekla'].includes(p.stanje);
// Ponuda je ili za igraonicu ili za šivanje: čim ima stavku igraonice ili prijevoza, datum isporuke je termin igraonice.
const STAVKA_IGRAONICE = /igraonic|soft\s*-?play|skakalic|prijevoz/i;
/** Usluga ponude po nazivima stavki: 'igraonica' ili 'sivanje'. */
export const uslugaPonude = (stavke = []) => (stavke.some((s) => STAVKA_IGRAONICE.test(s?.naziv || '')) ? 'igraonica' : 'sivanje');

/** Dani od `od` do `do` (uključivo) sa stavkama izrade, isporukama, terminima igraonice, ponudama iz Parre i opterećenjem. */
export function kalendarRaspona(narudzbe, od, doDatum, n, ponude = []) {
  const dani = [];
  for (let d = od; d <= doDatum && dani.length < 62; d = dodajDane(d, 1)) dani.push({ datum: d, izrada: [], isporuke: [], igraonica: [], ponude: [], sati: 0 });
  const indeks = new Map(dani.map((d, i) => [d.datum, i]));
  for (const p of ponude) {
    if (!ponudaUKalendaru(p) || !p.isporuka_od) continue;
    const kraj = p.isporuka_do && p.isporuka_do >= p.isporuka_od ? p.isporuka_do : p.isporuka_od;
    const zapis = { id: p.id, broj: p.broj, stanje: p.stanje, opis: p.opis, usluga: p.usluga || uslugaPonude(p.stavke), razdoblje: kraj !== p.isporuka_od };
    for (let d = p.isporuka_od, k = 0; d <= kraj && k < 62; d = dodajDane(d, 1), k++) {
      const i = indeks.get(d);
      if (i != null) dani[i].ponude.push(zapis);
    }
  }
  for (const nar of narudzbe) {
    if (nar.stanje === 'otkazano' || nar.stanje === 'upit') continue;
    const osnovno = { id: nar.id, sifra: nar.sifra, opis: nar.opis, stanje: nar.stanje, usluga: nar.usluga };
    if (nar.usluga === 'sivanje') {
      for (const iz of nar.izrada || []) {
        const i = indeks.get(iz.dan);
        if (i == null) continue;
        dani[i].izrada.push({ ...osnovno, sati: iz.sati });
        if (!['gotovo', 'isporuceno'].includes(nar.stanje)) dani[i].sati = zaokruzi(dani[i].sati + iz.sati, 2);
      }
      const i = indeks.get(nar.rok);
      if (i != null) dani[i].isporuke.push({ ...osnovno, dostava: nar.dostava });
    } else {
      const i = indeks.get((nar.termin_od || '').slice(0, 10));
      if (i != null) dani[i].igraonica.push({ ...osnovno, od: nar.termin_od?.slice(11, 16), do: nar.termin_do?.slice(11, 16), opcijaDo: nar.opcija_do });
    }
  }
  for (const d of dani) { d.kapacitet = n.kapacitet_sati_dan; d.preko = d.sati > n.kapacitet_sati_dan; }
  return { od, do: doDatum, dani };
}

/** Tjedan od ponedjeljka (7 dana). */
export function kalendarTjedna(narudzbe, odDatum, n, ponude = []) {
  const pon = ponedjeljak(odDatum);
  return { pogled: 'tjedan', ...kalendarRaspona(narudzbe, pon, dodajDane(pon, 6), n, ponude) };
}

/** Mjesec za mrežu: od ponedjeljka prvog tjedna do nedjelje zadnjeg; dani izvan mjeseca imaju izvan = true. */
export function kalendarMjeseca(narudzbe, datum, n, ponude = []) {
  const mjesec = datum.slice(0, 7), prvi = `${mjesec}-01`;
  const zadnji = dodajDane(`${dodajDane(prvi, 31).slice(0, 7)}-01`, -1);
  const k = kalendarRaspona(narudzbe, ponedjeljak(prvi), dodajDane(ponedjeljak(zadnji), 6), n, ponude);
  for (const d of k.dani) d.izvan = d.datum.slice(0, 7) !== mjesec;
  return { pogled: 'mjesec', mjesec, ...k };
}

// ---------- upozorenja ----------
/** Razina: 1 hitno, 2 upozorenje, 3 obavijest. Bez osobnih podataka: samo šifre i opisi narudžbi. */
export function upozorenja(narudzbe, skladiste, n, sada = new Date(), ponude = []) {
  const out = [];
  const danas = datumZagreb(sada);

  // Parra: isporučeno (datum prošao), a račun nije plaćen; gleda se zadnjih 60 dana.
  for (const p of ponude) {
    const kraj = p.isporuka_do || p.isporuka_od;
    if (!kraj || kraj >= danas || kraj < dodajDane(danas, -60)) continue;
    if (['prihvacena', 'racun', 'djelomicno'].includes(p.stanje))
      out.push({ razina: 2, vrsta: 'naplata', ponuda: p.id, tekst: `Ponuda ${p.broj}${p.opis ? ` (${p.opis})` : ''}: isporuka je bila ${hrDatum(kraj)}, a ${p.stanje === 'djelomicno' ? 'račun je plaćen samo djelomično' : p.stanje === 'racun' ? 'račun još nije plaćen' : 'račun još nije izdan'}.` });
  }
  const aktivne = narudzbe.filter(jeAktivna);
  const ime = (nar) => `${nar.sifra} (${nar.opis})`;

  for (const nar of aktivne) {
    if (nar.usluga === 'igraonica') {
      if (nar.stanje === 'opcija' && nar.opcija_do) {
        const sati = (new Date(nar.opcija_do) - sada) / 3600000;
        if (sati < 0) out.push({ razina: 1, vrsta: 'opcija', narudzba: nar.id, tekst: `Opcija ${ime(nar)} je istekla: potvrdi ili otkaži termin.` });
        else if (sati < 48) out.push({ razina: 1, vrsta: 'opcija', narudzba: nar.id, tekst: `Opcija ${ime(nar)} ističe za ${Math.round(sati)} h.` });
      }
      if (nar.termin_od && nar.termin_od.slice(0, 10) < danas) out.push({ razina: 2, vrsta: 'termin', narudzba: nar.id, tekst: `Termin ${ime(nar)} je prošao: označi kao odrađeno.` });
      continue;
    }
    if (nar.rok && nar.stanje !== 'upit' && nar.stanje !== 'ponuda') {
      if (nar.rok < danas) out.push({ razina: 1, vrsta: 'rok', narudzba: nar.id, tekst: `Rok za ${ime(nar)} je prošao (${hrDatum(nar.rok)}), a nije isporučeno.` });
      else if (nar.rok <= dodajDane(danas, n.dani_upozorenja_rok) && !['gotovo'].includes(nar.stanje))
        out.push({ razina: 1, vrsta: 'rok', narudzba: nar.id, tekst: `${ime(nar)} se isporučuje ${hrDatum(nar.rok)}, a još je „${NAZIV_STANJA[nar.stanje]}”.` });
    }
    if (nar.stanje === 'potvrdjeno' && !(nar.izrada || []).length && nar.rok && nar.rok <= dodajDane(danas, 7))
      out.push({ razina: 2, vrsta: 'plan', narudzba: nar.id, tekst: `${ime(nar)} nema planiran dan izrade, a rok je ${hrDatum(nar.rok)}.` });
  }

  // preopterećeni dani i sukobi termina u idućih 14 dana
  const sati = {}, termini = {};
  for (const nar of aktivne) {
    if (nar.usluga === 'sivanje') for (const iz of nar.izrada || []) if (iz.dan >= danas && !['gotovo'].includes(nar.stanje)) sati[iz.dan] = (sati[iz.dan] || 0) + iz.sati;
    if (nar.usluga === 'igraonica' && nar.termin_od) (termini[nar.termin_od.slice(0, 10)] ||= []).push(nar);
  }
  for (const [dan, s] of Object.entries(sati).sort()) if (dan <= dodajDane(danas, 14) && s > n.kapacitet_sati_dan)
    out.push({ razina: 2, vrsta: 'kapacitet', dan, tekst: `${hrDatum(dan)}: ${String(zaokruzi(s, 2)).replace('.', ',')} h šivanja, a kapacitet je ${n.kapacitet_sati_dan} h.` });
  for (const [dan, l] of Object.entries(termini)) if (l.length > 1)
    out.push({ razina: 1, vrsta: 'sukob', dan, tekst: `${hrDatum(dan)}: dvije rezervacije igraonice (${l.map((x) => x.sifra).join(', ')}).` });

  for (const a of skladiste) {
    if (a.status === 'kriticno') out.push({ razina: 1, vrsta: 'skladiste', artikl: a.id,
      tekst: a.rezervirano > a.stanje ? `${a.naziv}: potvrđene narudžbe traže ${fmt(a.rezervirano, a.jedinica)}, a na stanju je ${fmt(a.stanje, a.jedinica)}.`
        : `${a.naziv}: kritično malo (${fmt(a.raspolozivo, a.jedinica)}).` });
    else if (a.status === 'uskoro') out.push({ razina: 2, vrsta: 'skladiste', artikl: a.id,
      tekst: `${a.naziv}: naruči uskoro (${fmt(a.raspolozivo, a.jedinica)}${a.slova != null ? `, oko ${a.slova} slova` : ''}${a.tjedana != null ? `, oko ${Math.round(a.tjedana)} tj.` : ''}).` });
    if (a.staraInventura) out.push({ razina: 3, vrsta: 'inventura', artikl: a.id, tekst: `${a.naziv}: inventura starija od 30 dana.` });
  }
  return out.sort((a, b) => a.razina - b.razina);
}
const DANI = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];
/** „2026-11-25” → „sri 25. 11.” */
export const hrDatum = (d) => { const x = new Date(d + 'T12:00:00Z'); return `${DANI[x.getUTCDay()]} ${x.getUTCDate()}. ${x.getUTCMonth() + 1}.`; };
export const fmt = (x, j) => `${String(zaokruzi(x, j === 'm2' ? 2 : 1)).replace('.', ',')} ${j === 'm2' ? 'm²' : j}`;

// ---------- privatnost ----------
/** Nakon isporuke tekst bannera (ime djeteta) zamjenjuje se točkicama; dezeni i broj slova ostaju za povijest potrošnje. */
export const maskirajStavke = (stavke) => stavke.map((s) => (s.proizvod === 'banner'
  ? { ...s, tekst: s.tekst.replace(/[^ ]/g, '•') } : s));
