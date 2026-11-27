/* Mreže i marketing: tabovi po mreži (Sve mreže, Facebook, Instagram, TikTok), više računa po mreži, dodavanje i uklanjanje računa.
 * Podaci: GET /api/racuni (svi računi) i GET /api/mreze (brojke Meta računa). Ploča samo čita mreže; ništa ne objavljuje. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = P.esc;
  var tocke = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  var GORE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16l6-6 4 4 6-6"></path><path d="M15 8h5v5"></path></svg>';
  var DOLJE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8l6 6 4-4 6 6"></path><path d="M15 16h5v-5"></path></svg>';
  var SAT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path></svg>';
  var RAVNO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path></svg>';
  var IKONA = { gore: GORE, dolje: DOLJE, sat: SAT, ravno: RAVNO };
  var MREZE = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' }, ORD = ['facebook', 'instagram', 'tiktok'];
  var USLUGE = { banneri: 'Banneri', igraonica: 'Igraonica', oboje: 'Banneri i igraonica' };
  var VRSTA = { reel: 'Reel', video: 'Video', slika: 'Fotografija', album: 'Album', objava: 'Objava' };
  var DAN_KRATKO = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];

  var S = { upit: '', mjera: 'pregledi', tab: 'sve', racun: { facebook: 'sve', instagram: 'sve', tiktok: 'sve' }, dodaj: null, uklanjanje: null, racuni: [], podaci: null, ucitano: false, greska: null };

  /* ---- pomoćno ---- */
  function n(v) { return v == null ? '–' : tocke(v); }
  function kratko(v) { return v >= 1000 ? (v / 1000).toFixed(1).replace('.', ',') + 'k' : String(v); }
  function vrijemeHr(iso) { return new Date(iso).toLocaleString('hr-HR', { timeZone: 'Europe/Zagreb', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function datumHr(iso) { return new Date(iso).toLocaleDateString('hr-HR', { timeZone: 'Europe/Zagreb', day: 'numeric', month: 'numeric' }); }
  function postotak(p, tekst) { return '<span class="' + (p >= 0 ? 'rast' : 'pad') + '">' + (p >= 0 ? '+' : '') + p + ' %</span> ' + tekst; }
  function objaveRijec(k) { return k + (k % 10 === 1 && k % 100 !== 11 ? ' objava' : [2, 3, 4].indexOf(k % 10) >= 0 && [12, 13, 14].indexOf(k % 100) < 0 ? ' objave' : ' objava'); }
  function poruka(t, v) { P.poruka($('#poruka'), t, v); }
  function racuniMreze(m) { return S.racuni.filter(function (r) { return r.mreza === m; }); }
  function racunPo(id) { return S.racuni.filter(function (r) { return r.id === id; })[0] || null; }
  function podaciRacuna(id) { return ((S.podaci && S.podaci.racuni) || []).filter(function (r) { return r.id === id; })[0] || null; }
  function uslugaChip(r) { return '<span class="chip ' + (r.usluga === 'oboje' ? 'oboje' : r.usluga === 'banneri' ? 'sivanje' : 'igraonica') + '">' + USLUGE[r.usluga] + '</span>'; }
  function statusChip(r) {
    if (r.status === 'greska') return '<span class="chip greska">Greška</span>';
    if (r.status === 'spojeno') return '<span class="chip ok">Spojeno</span>';
    if (r.status === 'rucno') return '<span class="chip nepoznato">Ručni uvoz</span>';
    return '<span class="chip pozor">Čeka prvo osvježavanje</span>';
  }
  function izabran(m) {
    var rs = racuniMreze(m);
    if (!rs.length) return null;
    if (rs.length === 1) return rs[0];
    var id = S.racun[m];
    return id === 'sve' ? 'sve' : (racunPo(id) && racunPo(id).mreza === m ? racunPo(id) : 'sve');
  }
  function hashAzuriraj() {
    var m = S.tab, h = m;
    if (ORD.indexOf(m) >= 0 && S.racun[m] !== 'sve') h = m + ':' + S.racun[m];
    try { history.replaceState(null, '', '#' + h); } catch (e) {}
  }
  function hashProcitaj() {
    var h = (location.hash || '').slice(1).split(':');
    if (h[0] === 'sve' || ORD.indexOf(h[0]) >= 0) { S.tab = h[0]; if (h[1] && ORD.indexOf(h[0]) >= 0) S.racun[h[0]] = h[1]; }
  }

  /* ---- učitavanje ---- */
  var brojac = 0;
  function ucitaj() {
    var moj = ++brojac;
    return Promise.all([P.api('GET', '/api/racuni'), P.api('GET', '/api/mreze' + (S.upit ? '?' + S.upit : ''))]).then(function (r) {
      if (moj !== brojac) return; // stigao je noviji izbor razdoblja
      S.racuni = r[0].racuni || []; S.podaci = r[1]; S.ucitano = true; S.greska = null; crtaj();
    }).catch(function (e) { if (moj !== brojac) return; S.greska = e.message; S.ucitano = true; crtaj(); });
  }
  function dmg(iso) { var q = iso.split('-'); return +q[2] + '. ' + +q[1] + '. ' + q[0] + '.'; }
  function infoRazdoblja() {
    var el = $('#raz-info'), rz = S.podaci && S.podaci.razdoblje;
    if (!rz) { el.hidden = true; return; }
    var dana = function (n) { return n + (n % 10 === 1 && n % 100 !== 11 ? ' dan' : ' dana'); };
    el.textContent = 'Razdoblje: ' + dmg(rz.od) + (rz.dana > 1 ? ' – ' + dmg(rz.do) : '') + ' (' + dana(rz.dana) + '). Meta daje dnevne brojke s odgodom od 1 do 2 dana. Doseg je zbroj dnevnog dosega: ista se osoba broji svaki dan, pa za dulja razdoblja nije broj jedinstvenih osoba.';
    el.hidden = false;
  }

  /* ---- tabovi i traka računa ---- */
  function crtajTabove() {
    var t = [['sve', 'Sve mreže']].concat(ORD.map(function (m) { return [m, MREZE[m]]; }));
    $('#tabovi').innerHTML = t.map(function (x) {
      return '<button type="button" role="tab" data-tab="' + x[0] + '" aria-selected="' + (S.tab === x[0]) + '">' + x[1] + '</button>';
    }).join('');
  }
  function crtajTraku() {
    var el = $('#traka'), m = S.tab;
    if (ORD.indexOf(m) < 0) { el.hidden = true; el.innerHTML = ''; return; }
    var rs = racuniMreze(m), sel = izabran(m), h = '<span class="lbl">Računi</span>';
    if (rs.length > 1) h += '<button class="f" type="button" data-racun="sve" aria-pressed="' + (sel === 'sve') + '">Svi računi (' + rs.length + ')</button>';
    h += rs.map(function (r) { return '<button class="f" type="button" data-racun="' + esc(r.id) + '" aria-pressed="' + (sel && sel !== 'sve' && sel.id === r.id) + '">' + esc(r.naziv) + ' ' + uslugaChip(r) + '</button>'; }).join('');
    h += '<button class="btn malo" type="button" data-dodaj="' + m + '" aria-expanded="' + (S.dodaj === m) + '">+ Dodaj račun</button>';
    el.innerHTML = h; el.hidden = false;
  }

  /* ---- dodavanje računa ---- */
  function panelDodaj() {
    var m = S.dodaj;
    if (!m || m !== S.tab) return '';
    var ime = MREZE[m], uvod, polje, gumb, koraci;
    if (m === 'facebook') {
      uvod = 'Isti Meta token vrijedi za sve stranice koje je korisniku sustava dodijeljena imovina. Novu stranicu dovoljno je dodijeliti tom korisniku u Meta Business Suiteu.';
      polje = '<div class="polje"><label for="d-id">ID Facebook stranice</label><input id="d-id" type="text" inputmode="numeric" autocomplete="off" placeholder="npr. 104233998765432"><span class="sitno">Stranica, O stranici, Transparentnost stranice.</span></div>';
      gumb = 'Dodaj stranicu';
      koraci = ['Ploča spremi stranicu i pročita je pri idućem osvježavanju (do 6 sati) ili klikom na „Osvježi”.', 'Ako stranica ima povezan Instagram, doda se i na tab Instagram.'];
    } else if (m === 'instagram') {
      uvod = 'Instagram račun čita se preko Facebook stranice na koju je povezan, i mora biti poslovni ili kreatorski.';
      polje = '<div class="polje"><label for="d-id">ID Facebook stranice na koju je povezan Instagram</label><input id="d-id" type="text" inputmode="numeric" autocomplete="off" placeholder="npr. 104233998765432"><span class="sitno">Korisničko ime Instagram računa ploča pronađe sama pri prvom osvježavanju.</span></div>';
      gumb = 'Dodaj Instagram račun';
      koraci = ['Upišete ID stranice.', 'Uz Instagram se dodaje i Facebook stranica, ako je već niste dodali.', 'Pri prvom osvježavanju ploča pronađe Instagram i upiše njegovo korisničko ime.'];
    } else {
      uvod = 'TikTok račun se za sada samo bilježi na ploči. Brojke (ručni uvoz iz TikTok Studija, zatim TikTok API) dolaze u sljedećoj fazi.';
      polje = '<div class="polje"><label for="d-naziv-tt">Korisničko ime računa</label><input id="d-naziv-tt" type="text" autocomplete="off" placeholder="npr. @piccolini.play"></div>';
      gumb = 'Dodaj TikTok račun';
      koraci = ['Račun se pojavljuje na tabu TikTok i u usporedbi mreža.', 'Objave za TikTok već se odobravaju na stranici Objave.'];
    }
    return '<form class="kartica dodaj" id="forma-dodaj" novalidate><div><h2 style="font-size:20px">Novi ' + ime + ' račun</h2><p class="sitno" style="margin:4px 0 0">' + uvod + '</p></div>' +
      '<div class="mreza-polja">' + polje + (m === 'tiktok' ? '' : '<div class="polje"><label for="d-naziv">Naziv na ploči (nije obavezno)</label><input id="d-naziv" type="text" maxlength="60" autocomplete="off" placeholder="npr. ' + (m === 'facebook' ? 'Piccolini Šivanje' : '@piccolini.sivanje') + '"></div>') +
      '<div class="polje"><label for="d-usluga">Za koji posao je račun</label><select id="d-usluga"><option value="banneri">Banneri i šivanje</option><option value="igraonica">Igraonica</option><option value="oboje">Oboje</option></select></div></div>' +
      '<div><span class="sitno" style="font-weight:600;color:var(--ink-mid)">Što se događa kad kliknete</span><ol class="koraci" style="margin-top:6px">' + koraci.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol></div>' +
      '<div class="akcije-racuna"><button class="btn glavni" type="submit">' + gumb + '</button><button class="btn" type="button" data-dodaj-odustani="1">Odustani</button></div><p class="poruka greska" id="d-gr" aria-live="polite" style="margin:0"></p></form>';
  }

  /* ---- status ---- */
  function statusKartica() {
    var m = S.tab, meta = m === 'facebook' || m === 'instagram';
    if (m === 'sve') return '';
    var rs = racuniMreze(m), sel = izabran(m);
    if (!rs.length) return '<section class="kartica najava"><div><h2>Još nema ' + MREZE[m] + ' računa</h2><p class="sitno" style="margin:0">Dodaj prvi račun gumbom „Dodaj račun”.</p></div></section>';
    if (!meta) return '<section class="kartica najava"><div><span class="nadnaslov" style="font-size:12.5px">TikTok · ručni uvoz</span><h2>TikTok brojke još nisu spojene</h2><p class="sitno" style="margin:0">Računi su evidentirani. Brojke (ručni uvoz CSV-a iz TikTok Studija, zatim TikTok API) dolaze u sljedećoj fazi.</p></div></section>';
    if (S.podaci && !S.podaci.meta.spojeno)
      return '<section class="kartica najava"><div><h2>Instagram i Facebook još nisu spojeni</h2><p class="sitno" style="margin:0">Računi su dodani, ali ploča još nema Meta token. Za spajanje treba token korisnika sustava koji upišeš kao tajnu (META_TOKEN). Upute su u docs/META-SPAJANJE.md.</p></div></section>';
    var sp = rs.filter(function (r) { return r.status === 'spojeno'; }).length, greske = rs.filter(function (r) { return r.greska; });
    var jedan = sel && sel !== 'sve' ? sel : null;
    var tekst = jedan ? esc(jedan.naziv) + (jedan.zadnjeUspjesno ? ' · osvježeno ' + vrijemeHr(jedan.zadnjeUspjesno) + '. Dalje se osvježava svakih 6 sati.' : ' · još nije osvježeno. Klikni „Osvježi” ili pričekaj do 6 sati.')
      : sp + ' od ' + rs.length + ' računa spojeno. Svaki se osvježava zasebno, pa greška na jednom ne zaustavlja ostale.';
    var up = jedan ? (jedan.upozorenja || []) : [];
    var ukloni = '';
    if (jedan) ukloni = S.uklanjanje === jedan.id
      ? '<p class="sitno" style="margin:0">Ukloniti račun ' + esc(jedan.naziv) + '? Račun nestaje s ploče, a prikupljeni podaci ostaju u bazi.</p><div class="akcije-racuna"><button class="btn opasno malo" type="button" data-ukloni-da="' + esc(jedan.id) + '">Ukloni račun</button><button class="btn malo" type="button" data-ukloni-ne="1">Odustani</button></div>'
      : '<button class="btn malo" type="button" data-ukloni="' + esc(jedan.id) + '">Ukloni račun</button>';
    return '<section class="kartica najava"><div><span class="nadnaslov" style="font-size:12.5px">Meta · samo čitanje</span><h2>' + (jedan ? (jedan.status === 'greska' ? 'Račun ima grešku' : MREZE[m] + ' račun je spojen') : (greske.length ? greske.length + ' od ' + rs.length + ' računa ima grešku' : MREZE[m] + ' računi su spojeni')) + '</h2>' +
      '<p class="sitno" style="margin:0">' + tekst + '</p>' +
      (jedan && jedan.greska ? '<p class="sitno nedovoljno" style="margin:0;color:var(--danger)">' + esc(jedan.greska) + '</p>' : (!jedan ? greske.map(function (r) { return '<p class="sitno" style="margin:0;color:var(--danger)">' + esc(r.naziv) + ': ' + esc(r.greska) + '</p>'; }).join('') : '')) +
      (up.length ? '<ul class="upozorenja-mete">' + up.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul>' : '') + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;flex:0 1 auto;align-items:flex-start"><button class="btn" type="button" data-osvjezi="' + (jedan ? esc(jedan.id) : '') + '">Osvježi ' + (jedan ? 'račun' : MREZE[m]) + '</button>' + (jedan ? '<a class="btn malo" href="/objave.html#' + m + ':' + esc(jedan.id) + '">Objave ovog računa</a>' : '') + ukloni + '</div></section>';
  }

  /* ---- tablica računa ---- */
  function redRacuna(r) {
    var d = podaciRacuna(r.id), c = d && d.podaci;
    var ime = '<td><button class="racun-ime" type="button" data-otvori="' + esc(r.id) + '"><b>' + esc(r.naziv) + '</b>' + uslugaChip(r) + '</button></td>';
    if (!c || r.mreza === 'tiktok') return ime + '<td class="br" colspan="5"><span class="sitno">' + (r.mreza === 'tiktok' ? 'Brojke dolaze u sljedećoj fazi' : 'Još nema brojki, čeka prvo osvježavanje') + '</span></td><td>' + statusChip(r) + '</td></tr>';
    var rast = c.pratiteljiRast, rz = d.razdoblje;
    if (rz) {
      var pr = rz.pregledi, ps = pr.vrijednost == null ? '<span class="sitno" title="' + esc(rz.dnevnoGreska || 'Dnevne brojke se još učitavaju') + '">–</span>' : tocke(pr.vrijednost) + (pr.promjena == null ? '' : ' <span class="' + (pr.promjena >= 0 ? 'rast' : 'pad') + '" style="font-size:12.5px">' + (pr.promjena >= 0 ? '+' : '') + pr.promjena + ' %</span>') + (rz.pokriveno < S.podaci.razdoblje.dana ? ' <span class="sitno" title="Dnevnih brojki ima za ' + rz.pokriveno + ' od ' + S.podaci.razdoblje.dana + ' dana">*</span>' : '');
      return ime + '<td class="br">' + n(c.pratitelji) + '</td><td class="br">' + (rast == null ? '<span class="sitno" title="Rast se broji od prvog osvježavanja">–</span>' : '<span class="' + (rast >= 0 ? 'rast' : 'pad') + '">' + (rast >= 0 ? '+' : '−') + tocke(Math.abs(rast)) + '</span>') + '</td>' +
        '<td class="br">' + ps + '</td><td class="br">' + n(rz.doseg.vrijednost) + '</td><td class="br">' + n(rz.objaveBroj) + '</td><td>' + statusChip(r) + '</td></tr>';
    }
    return ime + '<td class="br">' + n(c.pratitelji) + '</td><td class="br">' + (rast == null ? '<span class="sitno" title="Rast se broji od prvog osvježavanja">–</span>' : '<span class="' + (rast >= 0 ? 'rast' : 'pad') + '">' + (rast >= 0 ? '+' : '−') + tocke(Math.abs(rast)) + '</span>') + '</td>' +
      '<td class="br">' + n(c.pregledi28) + (c.preglediPromjena == null ? '' : ' <span class="' + (c.preglediPromjena >= 0 ? 'rast' : 'pad') + '" style="font-size:12.5px">' + (c.preglediPromjena >= 0 ? '+' : '') + c.preglediPromjena + ' %</span>') + '</td>' +
      '<td class="br">' + n(c.doseg28) + '</td><td class="br">' + n(c.ukupnoObjava) + '</td><td>' + statusChip(r) + '</td></tr>';
  }
  var ZAGLAVLJE = '<thead><tr><th>Račun</th><th class="br">Pratitelji</th><th class="br">Rast</th><th class="br">Pregledi</th><th class="br">Doseg (zbroj dana)</th><th class="br">Objave</th><th>Status</th></tr></thead>';
  function tablica(rs, grupirano) {
    var redovi = grupirano
      ? ORD.map(function (m) { var l = rs.filter(function (r) { return r.mreza === m; }); return l.length ? '<tr class="mreza-red"><td colspan="7">' + MREZE[m] + '</td></tr><tr>' + l.map(redRacuna).join('<tr>') : ''; }).join('')
      : '<tr>' + rs.map(redRacuna).join('<tr>');
    return '<div class="tablica-omot"><table class="racuni">' + ZAGLAVLJE + '<tbody>' + redovi + '</tbody></table></div>';
  }

  function sveMreze() {
    var rs = S.racuni;
    if (!rs.length) return '<section class="kartica okvir"><h2>Još nema računa</h2><p class="sitno">Odaberite mrežu iznad i dodajte prvi račun.</p></section>';
    var pod = rs.map(function (r) { var d = podaciRacuna(r.id); return d && d.podaci ? { r: r, c: d.podaci, rz: d.razdoblje || null } : null; }).filter(Boolean);
    var sumP = 0, sumV = 0, sumR = 0, imaR = false, imaRz = pod.some(function (x) { return x.rz; });
    pod.forEach(function (x) { sumP += x.c.pratitelji || 0; sumV += imaRz ? (x.rz && x.rz.pregledi.vrijednost) || 0 : x.c.pregledi28 || 0; if (x.c.pratiteljiRast != null) { sumR += x.c.pratiteljiRast; imaR = true; } });
    var kpi = [
      ['Pratitelji, zbroj', pod.length ? tocke(sumP) : '–', imaR ? '<span class="' + (sumR >= 0 ? 'rast' : 'pad') + '">' + (sumR >= 0 ? '+' : '−') + tocke(Math.abs(sumR)) + '</span> od prvog osvježavanja' : 'rast se broji od prvog osvježavanja'],
      [imaRz ? 'Pregledi' : 'Pregledi, 28 dana', pod.length ? tocke(sumV) : '–', 'zbroj računa za odabrano razdoblje; svaka mreža broji preglede po svom'],
      ['Računi', String(rs.length), ORD.map(function (m) { var k = racuniMreze(m).length; return k ? MREZE[m] + ' ' + k : null; }).filter(Boolean).join(' · ')]
    ];
    return '<div class="kpi-red">' + kpi.map(function (k) { return '<div class="kartica kpi"><span class="naziv">' + k[0] + '</span><span class="broj">' + k[1] + '</span><span class="opis">' + k[2] + '</span></div>'; }).join('') + '</div>' +
      '<section class="kartica okvir"><div><h2>Računi po mrežama</h2><span class="sitno" style="font-size:13px">Klik na račun otvara njegove brojke. Doseg se ne zbraja među računima jer se ista osoba može pojaviti na više njih.</span></div>' + tablica(rs, true) + '</section>';
  }

  /* ---- graf kroz vrijeme (pregledi ili doseg po danu; za dulja razdoblja po tjednu) ---- */
  var GRAF = null;
  function seriju(serija, mjera, dana) {
    var vals = serija.filter(function (x) { return x[mjera] != null; });
    if (dana <= 31) return { pts: vals.map(function (x) { return { od: x.datum, do: x.datum, v: x[mjera] }; }), korak: 1 };
    var out = [], zadnji = vals.length - 1;
    for (var i = zadnji; i >= 0; i -= 7) {
      var dio = vals.slice(Math.max(0, i - 6), i + 1);
      if (dio.length < 7 && out.length) continue; // nepotpun početni tjedan se ispušta da graf ne pada
      out.unshift({ od: dio[0].datum, do: dio[dio.length - 1].datum, v: dio.reduce(function (a, x) { return a + x[mjera]; }, 0) });
    }
    return { pts: out, korak: 7 };
  }
  function grafRazdoblja(r, rz) {
    var dana = S.podaci.razdoblje.dana, mj = S.mjera === 'doseg' ? 'doseg' : 'pregledi';
    var naziv = mj === 'doseg' ? 'Doseg (zbroj dana)' : 'Pregledi';
    var ser = seriju(rz.serija, mj, dana);
    var glava = '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:flex-start"><div><h2>' + naziv + (dana > 1 ? (ser.korak === 1 ? ' po danu' : ' po tjednu') : '') + '</h2><span class="sitno" style="font-size:13.6px">' + dmg(S.podaci.razdoblje.od) + (dana > 1 ? ' – ' + dmg(S.podaci.razdoblje.do) : '') + '</span></div>' +
      '<label class="sitno">Mjera <select id="mjera-grafa" class="mali"><option value="pregledi"' + (mj === 'pregledi' ? ' selected' : '') + '>Pregledi</option><option value="doseg"' + (mj === 'doseg' ? ' selected' : '') + '>Doseg (zbroj dana)</option></select></label></div>';
    if (dana === 1) return '<section class="kartica okvir">' + glava + '<p class="prazno">Za jedan dan nema grafa. Odaberite 7 dana ili dulje.</p></section>';
    if (ser.pts.length < 2) return '<section class="kartica okvir">' + glava + '<p class="prazno">' + (rz.dnevnoGreska ? 'Meta ne daje dnevne ' + (mj === 'pregledi' ? 'preglede' : 'brojke') + ' za ovaj račun: ' + esc(rz.dnevnoGreska) : 'Za ovo razdoblje još nema dnevnih brojki. Povijest se učitava u komadima po 30 dana, svakih 6 sati.') + '</p></section>';
    var W = 640, H = 220, L = 46, R = 12, T = 12, B = 26, pts = ser.pts, max = Math.max.apply(null, pts.map(function (p) { return p.v; })), korak = Math.pow(10, Math.floor(Math.log10(Math.max(max, 1)))), vrh = Math.ceil(max / korak) * korak;
    if (vrh / korak < 3) { korak = korak / 2; vrh = Math.ceil(max / korak) * korak; }
    var x = function (i) { return L + i / (pts.length - 1) * (W - L - R); }, y = function (v) { return T + (1 - v / vrh) * (H - T - B); };
    var tk = []; for (var q = 0; q <= vrh + 1e-9; q += korak) tk.push(q); if (tk.length > 5) tk = tk.filter(function (_, i) { return i % 2 === 0; });
    var lin = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join(' ');
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(r.naziv + ': ' + naziv + ', ' + dmg(S.podaci.razdoblje.od) + ' do ' + dmg(S.podaci.razdoblje.do)) + '">';
    tk.forEach(function (v) { s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="var(--ink-soft)">' + kratko(Math.round(v)) + '</text>'; });
    [0, Math.floor((pts.length - 1) / 2), pts.length - 1].forEach(function (i, k) { s += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (k === 0 ? 'start' : k === 2 ? 'end' : 'middle') + '" font-size="11" fill="var(--ink-soft)">' + P.datum(pts[i].od) + '</text>'; });
    s += '<path d="' + lin + ' L' + x(pts.length - 1).toFixed(1) + ' ' + y(0) + ' L' + x(0).toFixed(1) + ' ' + y(0) + ' Z" fill="var(--accent)" fill-opacity=".08"/><path d="' + lin + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    s += '<circle cx="' + x(pts.length - 1) + '" cy="' + y(pts[pts.length - 1].v) + '" r="4.5" fill="var(--accent)" stroke="var(--white)" stroke-width="2"/>';
    s += '<g class="hv" visibility="hidden"><line y1="' + T + '" y2="' + (H - B) + '" stroke="var(--line-strong)"/><circle r="4.5" fill="var(--accent)" stroke="var(--white)" stroke-width="2"/></g><rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent"/></svg><div class="oblacic" hidden></div>';
    GRAF = { pts: pts, x: x, y: y, W: W, H: H, L: L, R: R, korak: ser.korak };
    return '<section class="kartica okvir">' + glava + '<div class="graf" id="graf">' + s + '</div></section>';
  }
  function veziGraf() {
    var el = $('#graf'); if (!el || !GRAF) return;
    var svg = el.querySelector('svg'), hv = svg.querySelector('.hv'), ln = hv.querySelector('line'), c = hv.querySelector('circle'), ob = el.querySelector('.oblacic');
    function pokazi(e) {
      var r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * GRAF.W, n2 = GRAF.pts.length;
      var i = Math.max(0, Math.min(n2 - 1, Math.round((sx - GRAF.L) / (GRAF.W - GRAF.L - GRAF.R) * (n2 - 1)))), p = GRAF.pts[i], px = GRAF.x(i), py = GRAF.y(p.v);
      hv.setAttribute('visibility', 'visible'); ln.setAttribute('x1', px); ln.setAttribute('x2', px); c.setAttribute('cx', px); c.setAttribute('cy', py);
      ob.hidden = false; ob.style.left = (px / GRAF.W * r.width) + 'px'; ob.style.top = (py / GRAF.H * r.height) + 'px';
      ob.innerHTML = (GRAF.korak === 1 ? P.datum(p.od) : P.datum(p.od) + ' – ' + P.datum(p.do)) + ' · <b>' + tocke(p.v) + '</b>';
    }
    svg.addEventListener('pointermove', pokazi); svg.addEventListener('pointerdown', pokazi);
    svg.addEventListener('pointerleave', function () { hv.setAttribute('visibility', 'hidden'); ob.hidden = true; });
  }

  /* ---- brojke jednog računa (kao prije, po računu) ---- */
  function racunBrojke(r) {
    var d = podaciRacuna(r.id), c = d && d.podaci, fb = r.mreza === 'facebook';
    if (!c || !r.zadnje) return '<section class="kartica okvir"><h2>' + esc(r.naziv) + ': još nema brojki</h2><p class="sitno">Brojke se pojave nakon prvog osvježavanja računa (do 6 sati) ili klikom na „Osvježi”. Rast pratitelja broji se od tog dana.</p></section>';
    var rast = c.pratiteljiRast, h = '';
    var rz = d.razdoblje, rzOk = rz && rz.pregledi && S.podaci.razdoblje, kpi;
    var pratKpi = ['Pratitelji', n(c.pratitelji), rast == null ? 'rast se broji od prvog osvježavanja, dan po dan' : '<span class="' + (rast >= 0 ? 'rast' : 'pad') + '">' + (rast >= 0 ? '+' : '') + rast + '</span> od ' + P.datum(c.pratiteljiOd)];
    if (rzOk) {
      var dd = S.podaci.razdoblje.dana, pr = rz.pregledi, ds = rz.doseg;
      var nepotpuno = rz.pokriveno < dd ? '<span class="pad">dnevnih brojki ima za ' + rz.pokriveno + ' od ' + dd + ' dana' + (rz.povijestDnevnoOd ? ' (učitano od ' + P.datum(rz.povijestDnevnoOd) + ')' : '') + '</span>' : '';
      var razlog = rz.dnevnoGreska ? '<span class="pad">Meta ne daje: ' + esc(rz.dnevnoGreska) + '</span>' : (rz.pokriveno === 0 ? 'dnevne brojke se još učitavaju (do 6 sati po komadu)' : '');
      kpi = [
        ['Pregledi', pr.vrijednost == null ? '–' : tocke(pr.vrijednost), pr.vrijednost == null ? (razlog || 'nema dnevnih brojki za razdoblje') : (nepotpuno || (pr.promjena == null ? 'usporedba nije moguća: prethodno razdoblje nije učitano' : postotak(pr.promjena, 'naspram prethodnog razdoblja')))],
        ['Doseg (zbroj dana)', ds.vrijednost == null ? '–' : tocke(ds.vrijednost), ds.vrijednost == null ? 'nema dnevnih brojki za razdoblje' : (ds.promjena == null ? 'ista se osoba broji svaki dan' : postotak(ds.promjena, 'naspram prethodnog razdoblja'))],
        ['Objave u razdoblju', String(rz.objaveBroj), rz.objaveDostupnoOd ? 'ploča čuva objave od ' + P.datum(rz.objaveDostupnoOd) : 'još nema spremljenih objava'],
        fb ? ['Zadnjih 5 objava', n(c.prosjekZadnjih5), c.promjena5 == null ? 'prosjek pregleda · usporedba kad bude 10 objava s brojkama' : postotak(c.promjena5, 'naspram prethodnih 5')]
          : ['Spremanja po objavi', c.spremanjaPoObjavi == null ? '–' : P.broj(c.spremanjaPoObjavi, 1), 'zadnjih 5 objava · najbolji signal da se netko vraća'],
        pratKpi
      ];
    } else {
      kpi = [
        ['Zadnjih 5 objava', n(c.prosjekZadnjih5), c.promjena5 == null ? 'prosjek pregleda · usporedba kad bude 10 objava s brojkama' : postotak(c.promjena5, 'naspram prethodnih 5')],
        ['Doseg, 28 dana', n(c.doseg28), c.dosegPromjena == null ? 'koliko je računa vidjelo sadržaj' : postotak(c.dosegPromjena, 'naspram prethodnih 28 dana')],
        fb ? ['Pregledi, 28 dana', n(c.pregledi28), c.preglediPromjena == null ? 'svi pregledi sadržaja stranice' : postotak(c.preglediPromjena, 'naspram prethodnih 28 dana')]
          : ['Spremanja po objavi', c.spremanjaPoObjavi == null ? '–' : P.broj(c.spremanjaPoObjavi, 1), 'zadnjih 5 objava · najbolji signal da se netko vraća'],
        pratKpi
      ];
    }
    var v = c.graf, graf, max = Math.max.apply(null, v.map(function (x) { return x.pregledi; }).concat([1]));
    if (!v.length) graf = '<p class="prazno" style="align-self:center">Još nema objava s brojkama.</p>';
    else {
      var zad = v.slice(-5), pz = Math.round(zad.reduce(function (s, x) { return s + x.pregledi; }, 0) / zad.length);
      graf = (v.length >= 6 ? '<span class="prosjek" style="bottom:' + Math.round(pz / max * 139) + 'px"></span>' : '') + v.map(function (x, i) {
        return '<div class="stupac-grafa' + (i >= v.length - 5 ? ' novi' : '') + '" title="' + esc(datumHr(x.objavljeno) + ' · ' + (VRSTA[x.vrsta] || '') + (x.opis ? ' · ' + x.opis : '')) + '"><small>' + kratko(x.pregledi) + '</small><i style="height:' + Math.max(2, Math.round(x.pregledi / max * 82)) + '%"></i></div>';
      }).join('');
    }
    var sati = S.podaci.sati, dani = S.podaci.dani, maxT = 0;
    c.toplina.forEach(function (row) { row.forEach(function (x) { if (x.prosjek > maxT) maxT = x.prosjek; }); });
    var top = '<span></span>' + sati.map(function (s) { return '<span class="z">' + s + ' h</span>'; }).join('') + c.toplina.map(function (row, i) {
      return '<span class="z dan">' + DAN_KRATKO[i] + '</span>' + row.map(function (x, j) {
        if (!x.objava) return '<span class="polje-t prazno" title="nema objava">·</span>';
        var t = maxT ? x.prosjek / maxT : 0, naj = c.najbolje && c.najbolje.dan === i && c.najbolje.sat === j;
        return '<span class="polje-t' + (naj ? ' najbolje' : '') + '" title="' + objaveRijec(x.objava) + ', prosječno ' + tocke(x.prosjek) + ' pregleda" style="background:color-mix(in srgb, var(--kadulja) ' + Math.round(8 + t * 85) + '%, transparent);color:' + (t > 0.55 ? 'var(--on-accent)' : 'var(--ink)') + '">' + kratko(x.prosjek) + '</span>';
      }).join('');
    }).join('');
    var kad = c.kadObjaviti, redovi = [];
    if (kad.sat) redovi.push('<strong style="color:var(--ink)">Po satu:</strong> oko ' + sati[kad.sat.indeks] + ' h (medijan ' + tocke(kad.sat.medijan) + ' pregleda, ' + objaveRijec(kad.sat.objava) + ').');
    if (kad.dan) redovi.push('<strong style="color:var(--ink)">Po danu:</strong> ' + esc(dani[kad.dan.indeks]) + ' (medijan ' + tocke(kad.dan.medijan) + ' pregleda, ' + objaveRijec(kad.dan.objava) + ').');
    if (!kad.sat && !kad.dan) redovi.push('Za preporuku treba barem 3 objave u istom satu ili istom danu.');
    if (kad.jedna) redovi.push('Najjača pojedinačna objava: ' + esc(dani[kad.jedna.dan]) + ' oko ' + sati[kad.jedna.sat] + ' h, ' + tocke(kad.jedna.pregledi) + ' pregleda. Jedna objava ne čini obrazac.');
    redovi.push('<span class="sitno" style="font-size:13px">Na temelju ' + objaveRijec(kad.uzorak) + ' s brojkama; preporuka je pouzdanija od oko 15 objava.</span>');
    var uvidi = c.uvidi.length ? c.uvidi.map(function (u) { return '<div class="uvid">' + (IKONA[u.smjer] || RAVNO) + '<span>' + esc(u.tekst) + '</span></div>'; }).join('') : '<p class="prazno">Još premalo objava s brojkama za usporedbu.</p>';
    var objavaIzvor = rzOk ? rz.objave : c.objave;
    var objave = objavaIzvor.length ? objavaIzvor.slice(0, 8).map(function (o) {
      var brojke = '<span class="brojke"><b>' + n(o.pregledi) + '</b> pregleda<br>' + n(o.doseg) + ' doseg' + (o.spremanja != null ? ' · ' + n(o.spremanja) + ' spr.' : '') + '</span>';
      var tijelo = '<strong>' + esc(o.opis || VRSTA[o.vrsta] || 'Objava') + '</strong>' + brojke + '<span class="meta-l">' + esc((VRSTA[o.vrsta] || 'Objava') + ' · ' + datumHr(o.objavljeno)) + '</span>';
      return o.poveznica ? '<a class="objava-red" href="' + esc(o.poveznica) + '" target="_blank" rel="noopener">' + tijelo + '</a>' : '<div class="objava-red">' + tijelo + '</div>';
    }).join('') : '<p class="prazno">Još nema objava.</p>';
    h += '<section class="kartica okvir sazetak-mreza" style="gap:8px"><h2>Što se vidi iz brojki</h2><span class="sitno" style="font-size:13px">Izračun ploče iz objava računa ' + esc(r.naziv) + '. Tjedni sažetak Analitičara mreža dolazi kad se pokrene agent.</span><div>' + uvidi + '</div></section>' +
      '<div class="kpi-red">' + kpi.map(function (k) { return '<div class="kartica kpi"><span class="naziv">' + k[0] + '</span><span class="broj">' + k[1] + '</span><span class="opis">' + k[2] + '</span></div>'; }).join('') + '</div>' + (rzOk ? grafRazdoblja(r, rz) : '') +
      '<div class="par"><section class="kartica okvir"><div style="display:flex;flex-direction:column;gap:2px"><h2>Pregledi zadnjih 10 objava</h2><span class="sitno" style="font-size:13.6px">Svijetli stupci su prethodnih 5, tamni zadnjih 5. Crtkana crta je prosjek zadnjih 5.</span></div><div class="stupci-grafa" role="img" aria-label="' + esc(r.naziv) + ': pregledi zadnjih 10 objava">' + graf + '</div><div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--ink-soft)"><span>starije</span><span>novije</span></div></section>' +
      '<section class="kartica okvir"><div style="display:flex;flex-direction:column;gap:2px"><h2>Kad objaviti</h2><span class="sitno" style="font-size:13.6px">Prosječni pregledi po danu i satu objave, zadnjih 180 dana, samo za ovaj račun.</span></div><div class="toplina" role="table" aria-label="Pregledi po danu i satu objave">' + top + '</div><p style="margin:0;font-size:14.6px;color:var(--ink-mid)">' + redovi.map(function (x) { return '<span style="display:block">' + x + '</span>'; }).join('') + '</p></section></div>' +
      '<section class="kartica okvir" style="gap:6px"><h2>Zadnje objave</h2><span class="sitno" style="font-size:13px">Pregledi · doseg · spremanja. Klik otvara objavu.</span><div>' + objave + '</div></section>';
    return h;
  }

  function mrezaSadrzaj() {
    var m = S.tab, rs = racuniMreze(m), sel = izabran(m);
    if (!rs.length) return '';
    if (m === 'tiktok') return '<section class="kartica okvir"><h2>TikTok računi</h2>' + tablica(rs, false) + '</section>';
    if (sel === 'sve') return '<section class="kartica okvir"><div><h2>Računi: ' + MREZE[m] + '</h2><span class="sitno" style="font-size:13px">Odaberite račun za brojke po objavama i „Kad objaviti”. Ti pregledi ne miješaju publike različitih računa.</span></div>' + tablica(rs, false) + '</section>';
    return racunBrojke(sel);
  }

  /* ---- glavno crtanje ---- */
  function crtaj() {
    GRAF = null;
    crtajTabove(); crtajTraku(); infoRazdoblja();
    $('#dodaj-mjesto').innerHTML = panelDodaj();
    if (S.greska) { $('#status-mjesto').innerHTML = ''; $('#sadrzaj').innerHTML = '<p class="poruka greska">' + esc(S.greska) + '</p>'; return; }
    if (!S.ucitano) { $('#sadrzaj').innerHTML = '<p class="prazno">Učitavam…</p>'; return; }
    $('#status-mjesto').innerHTML = statusKartica();
    $('#sadrzaj').innerHTML = S.tab === 'sve' ? sveMreze() : mrezaSadrzaj();
    veziGraf();
  }

  /* ---- događaji ---- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var d = b.dataset;
    if (d.tab) { S.tab = d.tab; S.dodaj = null; S.uklanjanje = null; poruka(''); hashAzuriraj(); crtaj(); return; }
    if (d.racun) { S.racun[S.tab] = d.racun; S.uklanjanje = null; hashAzuriraj(); crtaj(); return; }
    if (d.otvori) { var r = racunPo(d.otvori); if (r) { S.tab = r.mreza; S.racun[r.mreza] = r.id; hashAzuriraj(); crtaj(); window.scrollTo({ top: 0 }); } return; }
    if (d.dodaj) { S.dodaj = S.dodaj === d.dodaj ? null : d.dodaj; crtaj(); var i = $('#d-id') || $('#d-naziv-tt'); if (i) i.focus(); return; }
    if (d.dodajOdustani) { S.dodaj = null; crtaj(); return; }
    if (d.ukloni) { S.uklanjanje = d.ukloni; crtaj(); return; }
    if (d.ukloniNe) { S.uklanjanje = null; crtaj(); return; }
    if (d.ukloniDa) {
      b.disabled = true;
      P.api('DELETE', '/api/racuni/' + encodeURIComponent(d.ukloniDa), {}).then(function () { S.uklanjanje = null; S.racun[S.tab] = 'sve'; poruka('Račun je uklonjen s ploče. Podaci ostaju u bazi.', 'ok'); hashAzuriraj(); return ucitaj(); })
        .catch(function (err) { b.disabled = false; poruka(err.message, 'greska'); });
      return;
    }
    if (d.osvjezi !== undefined) {
      if (S.tab === 'tiktok') return;
      b.disabled = true; poruka('Čitam ' + (d.osvjezi ? 'račun' : MREZE[S.tab]) + '…');
      P.api('POST', '/api/meta/osvjezi', d.osvjezi ? { racun: d.osvjezi } : {}).then(function (r) { poruka('Objava: ' + r.objava + ', osvježenih brojki: ' + r.uvida + '.', 'ok'); return ucitaj(); })
        .catch(function (err) { poruka(err.message, 'greska'); return ucitaj(); });
    }
  });
  document.addEventListener('change', function (e) { if (e.target.id === 'mjera-grafa') { S.mjera = e.target.value; crtaj(); } });
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'forma-dodaj') return;
    e.preventDefault();
    var m = S.dodaj, tijelo = { mreza: m, usluga: $('#d-usluga').value }, gr = $('#d-gr');
    gr.textContent = '';
    if (m === 'tiktok') tijelo.naziv = $('#d-naziv-tt').value.trim();
    else { tijelo.id_stranice = $('#d-id').value.trim(); tijelo.naziv = $('#d-naziv').value.trim(); }
    var gumb = e.target.querySelector('button[type=submit]'); gumb.disabled = true;
    P.api('POST', '/api/racuni', tijelo).then(function (r) {
      var novi = (r.dodano || []).filter(function (x) { return x.mreza === m; })[0];
      S.dodaj = null; if (novi && racuniMreze(m).length >= 0) S.racun[m] = novi.id;
      poruka('Račun je dodan' + (m === 'tiktok' ? '.' : '. Brojke stižu pri prvom osvježavanju (do 6 sati) ili klikom na „Osvježi”.'), 'ok');
      return ucitaj().then(hashAzuriraj);
    }).catch(function (err) { gumb.disabled = false; gr.textContent = err.message; });
  });
  $('#tabovi').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var t = ['sve'].concat(ORD), i = t.indexOf(S.tab);
    S.tab = t[(i + (e.key === 'ArrowRight' ? 1 : -1) + t.length) % t.length]; hashAzuriraj(); crtaj();
    var el = $('[data-tab="' + S.tab + '"]'); if (el) el.focus();
  });
  window.addEventListener('hashchange', function () { hashProcitaj(); crtaj(); });

  hashProcitaj(); crtaj();
  RAZ.init($('#razdoblje'), { skrijRaspon: true, onChange: function (r) { S.upit = r.preset === 'custom' ? 'od=' + r.od + '&do=' + r.do : 'dana=' + r.dana; ucitaj(); } });
})();
