/* Zajednički filter razdoblja za ekrane s povijesnim podacima (Mreže, Web, Prodaja, Financije, Pregled).
 * Isti izbor vrijedi na svim ekranima (sessionStorage), ali svaki ekran nudi samo razdoblja koja njegovi podaci podržavaju:
 * nedostupna su zasivljena s objašnjenjem, ne skrivena. Dani: zadnji potpuni dan je jučer; povijest je najviše godinu dana.
 * Upotreba: RAZ.init(element, { dostupno: ['28','90','180','365'], razlog: 'Upiti se upisuju tjedno.', mjesecno: false, onChange: function (r) {} })
 *   r (dani):     { preset, od: 'YYYY-MM-DD', do: 'YYYY-MM-DD', dana, prethodno: { od, do } | null }
 *   r (mjeseci):  { preset, od: 'YYYY-MM', do: 'YYYY-MM', n }   (za podatke koji se vode po mjesecu) */
(function () {
  'use strict';
  var KLJUC = 'ploca-razdoblje', GODINA = 365;
  var PRESETI = [['1', '1 dan'], ['7', '7 dana'], ['28', '28 dana'], ['90', '3 mjeseca'], ['180', '6 mjeseci'], ['365', 'Godina']];
  var MJESECI = { '90': 3, '180': 6, '365': 12 };
  var MJ = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var CSS = '.raz{display:flex;flex-direction:column;gap:10px}' +
    '.raz .red{display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
    '.raz .lbl{font-size:12.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);margin-right:2px}' +
    '.raz button.f{min-height:38px;padding:0 14px;border-radius:3px;border:1px solid var(--line);background:var(--white);color:var(--ink-mid);font-size:14px;font-weight:500;cursor:pointer}' +
    '.raz button.f[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}' +
    '.raz button.f:disabled{opacity:.45;cursor:not-allowed}' +
    '.raz form{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;padding:14px 16px;background:var(--white);border:1px solid var(--line);border-radius:4px}' +
    '.raz form .polje{width:11rem}' +
    '.raz form .greska{flex-basis:100%;margin:0;color:var(--danger);font-size:14px;font-weight:500}' +
    '.raz .info{margin:0;font-size:14px;color:var(--ink-soft)}.raz .info strong{color:var(--ink-mid)}';
  if (!document.getElementById('raz-css')) { var st = document.createElement('style'); st.id = 'raz-css'; st.textContent = CSS; document.head.appendChild(st); }

  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var iso = function (d) { return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); };
  var dodaj = function (s, k) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return iso(d); };
  var datumHr = function (s) { var q = s.split('-'); return +q[2] + '. ' + +q[1] + '. ' + q[0] + '.'; };
  var mjesecHr = function (s) { var q = s.split('-'); return MJ[+q[1] - 1] + ' ' + q[0] + '.'; };
  function danasZg() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb' }).format(new Date()); }
  /** Zadnji potpuni dan; `odgoda` su dodatni dani za izvore koji kasne (Search Console ima konačne brojke tek nakon 2–3 dana). */
  function zadnjiDan(opcije) { return dodaj(danasZg(), -1 - ((opcije && opcije.odgoda) || 0)); }
  function razlikaDana(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }
  function plusMj(mj, k) { var q = mj.split('-').map(Number), d = new Date(Date.UTC(q[0], q[1] - 1 + k, 1)); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1); }

  function citaj() { try { return JSON.parse(sessionStorage.getItem(KLJUC)) || null; } catch (e) { return null; } }
  function spremi(s) { try { sessionStorage.setItem(KLJUC, JSON.stringify(s)); } catch (e) {} }

  /** Izračun razdoblja iz izbora. Vraća objekt kao u zaglavlju datoteke. */
  function izracunaj(izbor, opcije) {
    var kraj = zadnjiDan(opcije);
    if (opcije.mjesecno) {
      var tekuci = danasZg().slice(0, 7), od, doM, n;
      if (izbor.preset === 'custom') { od = izbor.odM; doM = izbor.doM; n = razlikaMjeseci(od, doM) + 1; }
      else { n = MJESECI[izbor.preset]; doM = tekuci; od = plusMj(tekuci, -(n - 1)); }
      return { preset: izbor.preset, od: od, do: doM, n: n };
    }
    var a, b, dana;
    if (izbor.preset === 'custom') { a = izbor.od; b = izbor.do; dana = razlikaDana(a, b) + 1; }
    else { dana = +izbor.preset; b = kraj; a = dodaj(kraj, -(dana - 1)); }
    var pr = dodaj(a, -dana) >= dodaj(kraj, -(GODINA - 1)) ? { od: dodaj(a, -dana), do: dodaj(a, -1) } : null;
    return { preset: izbor.preset, od: a, do: b, dana: dana, prethodno: pr };
  }
  function razlikaMjeseci(a, b) { var x = a.split('-').map(Number), y = b.split('-').map(Number); return (y[0] - x[0]) * 12 + (y[1] - x[1]); }

  function init(el, opcije) {
    opcije = opcije || {};
    var dostupno = opcije.dostupno || PRESETI.map(function (p) { return p[0]; });
    var izbor = citaj() || { preset: opcije.zadano || (dostupno.indexOf('28') >= 0 ? '28' : dostupno[0]) };
    var kraj = zadnjiDan(opcije), najranije = dodaj(kraj, -(GODINA - 1));
    if (!izbor.od || !izbor.do) { izbor.od = dodaj(kraj, -89); izbor.do = kraj; }
    if (!izbor.odM || !izbor.doM) { izbor.odM = plusMj(danasZg().slice(0, 7), -5); izbor.doM = danasZg().slice(0, 7); }
    var greska = '';

    function efektivni() { return izbor.preset === 'custom' || dostupno.indexOf(izbor.preset) >= 0 ? izbor.preset : dostupno[0]; }
    function crtaj() {
      var ef = efektivni(), cust = ef === 'custom', r = izracunaj({ preset: ef, od: izbor.od, do: izbor.do, odM: izbor.odM, doM: izbor.doM }, opcije);
      var h = '<div class="red" role="group" aria-label="Razdoblje"><span class="lbl">Razdoblje</span>' + PRESETI.map(function (p) {
        var ok = dostupno.indexOf(p[0]) >= 0;
        return '<button type="button" class="f" data-raz="' + p[0] + '" aria-pressed="' + (ef === p[0]) + '"' + (ok ? '' : ' disabled title="' + esc(opcije.razlog || 'Za ovaj ekran nije dostupno.') + '"') + '>' + p[1] + '</button>';
      }).join('') + '<button type="button" class="f" data-raz="custom" aria-pressed="' + cust + '">Prilagođeno</button></div>';
      if (cust) {
        var tip = opcije.mjesecno ? 'month' : 'date', lo = opcije.mjesecno ? najranije.slice(0, 7) : najranije, hi = opcije.mjesecno ? kraj.slice(0, 7) : kraj;
        var vOd = opcije.mjesecno ? izbor.odM : izbor.od, vDo = opcije.mjesecno ? izbor.doM : izbor.do;
        h += '<form data-raz-forma novalidate><div class="polje"><label for="raz-od">Od</label><input id="raz-od" type="' + tip + '" min="' + lo + '" max="' + hi + '" value="' + vOd + '"></div>' +
          '<div class="polje"><label for="raz-do">Do</label><input id="raz-do" type="' + tip + '" min="' + lo + '" max="' + hi + '" value="' + vDo + '"></div>' +
          '<button class="btn glavni" type="submit">Primijeni</button>' + (greska ? '<p class="greska" aria-live="polite">' + esc(greska) + '</p>' : '') + '</form>';
      }
      var opis = opcije.mjesecno ? mjesecHr(r.od) + (r.n > 1 ? ' – ' + mjesecHr(r.do) : '') + ' (' + r.n + (r.n === 1 ? ' mjesec' : r.n < 5 ? ' mjeseca' : ' mjeseci') + ')'
        : datumHr(r.od) + (r.dana > 1 ? ' – ' + datumHr(r.do) : '') + ' (' + r.dana + (r.dana % 10 === 1 && r.dana % 100 !== 11 ? ' dan' : ' dana') + ')';
      var usp = '';
      if (!opcije.mjesecno) usp = r.prethodno ? ' · usporedba s ' + datumHr(r.prethodno.od) + (r.dana > 1 ? ' – ' + datumHr(r.prethodno.do) : '') : ' · bez usporedbe: prethodno razdoblje izlazi iz godine dana povijesti';
      var nap = '';
      if (izbor.preset !== 'custom' && dostupno.indexOf(izbor.preset) < 0) nap = ' · Razdoblje „' + (PRESETI.filter(function (p) { return p[0] === izbor.preset; })[0] || ['', ''])[1] + '” ovdje nije moguće. ' + (opcije.razlog || '') + ' Prikazano: ' + (PRESETI.filter(function (p) { return p[0] === ef; })[0] || ['', ''])[1] + '.';
      if (opcije.mjesecno && cust) nap += ' · Prihod se vodi po mjesecu isporuke, pa se razdoblje računa u cijelim mjesecima.';
      if (opcije.napomena) nap += ' · ' + opcije.napomena(r);
      if (!opcije.skrijRaspon) h += '<p class="info"><strong>' + opis + '</strong>' + usp + esc(nap).replace(/&#39;/g, "'") + '</p>';
      else if (nap) h += '<p class="info">' + esc(nap.replace(/^ · /, '')) + '</p>';
      el.className = (el.className.replace(/\braz\b/, '') + ' raz').trim();
      el.innerHTML = h;
      return r;
    }
    function javi() { var r = crtaj(); if (opcije.onChange) opcije.onChange(r); }

    el.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-raz]'); if (!b || b.disabled) return;
      izbor.preset = b.dataset.raz; greska = ''; spremi(izbor); javi();
    });
    el.addEventListener('submit', function (e) {
      if (!e.target.hasAttribute('data-raz-forma')) return;
      e.preventDefault();
      var od = el.querySelector('#raz-od').value, doV = el.querySelector('#raz-do').value, m = !!opcije.mjesecno;
      var lo = m ? najranije.slice(0, 7) : najranije, hi = m ? kraj.slice(0, 7) : kraj;
      if (!od || !doV) greska = 'Upišite oba datuma.';
      else if (od > doV) greska = 'Početak mora biti prije kraja razdoblja.';
      else if (od < lo || doV > hi) greska = 'Podaci postoje samo za zadnjih godinu dana: ' + (m ? mjesecHr(lo) + ' – ' + mjesecHr(hi) : datumHr(lo) + ' – ' + datumHr(hi));
      else if (m && razlikaMjeseci(od, doV) + 1 > 24) greska = 'Najviše 24 mjeseca.';
      else if (!m && opcije.najmanjeDana && razlikaDana(od, doV) + 1 < opcije.najmanjeDana) greska = 'Razdoblje mora imati barem ' + opcije.najmanjeDana + ' dana.';
      else { greska = ''; if (m) { izbor.odM = od; izbor.doM = doV; } else { izbor.od = od; izbor.do = doV; } izbor.preset = 'custom'; spremi(izbor); }
      javi();
    });
    javi();
    return { trenutno: function () { return izracunaj({ preset: efektivni(), od: izbor.od, do: izbor.do, odM: izbor.odM, doM: izbor.doM }, opcije); } };
  }
  window.RAZ = { init: init };
})();
