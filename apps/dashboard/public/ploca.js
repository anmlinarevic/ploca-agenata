/* Zajednička bočna navigacija ploče tvrtke (po odjelima) i popis agenata s odjelima.
 * Uključuje se na svakoj stranici; skriva staru gornju navigaciju (.zaglavlje .tabovi). */
(function () {
  'use strict';
  var IK = {
    pregled: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    prodaja: '<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    proizvodnja: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.2 7.8L20 18M8.2 16.2L20 6"/>',
    mreze: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 10.9l7.4-3.8M8.3 13.1l7.4 3.8"/>',
    financije: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    kalendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    zadaci: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5"/>',
    agenti: '<rect x="5" y="7" width="14" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9.5 16h5"/>',
    izvori: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5"/>'
  };
  function ikona(ime, v) { v = v || 18; return '<svg width="' + v + '" height="' + v + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IK[ime] || '') + '</svg>'; }

  var ODJELI = [
    { id: 'prodaja', naziv: 'Prodaja', href: '/prodaja.html' },
    { id: 'proizvodnja', naziv: 'Proizvodnja', href: '/skladiste.html' },
    { id: 'mreze', naziv: 'Mreže i marketing', href: '/mreze.html' },
    { id: 'financije', naziv: 'Financije', href: '/financije.html' },
    { id: 'web', naziv: 'Web', href: '/web.html' }
  ];
  var NAZIV_ODJELA = { uprava: 'Uprava' };
  ODJELI.forEach(function (o) { NAZIV_ODJELA[o.id] = o.naziv; });

  /* Agenti: postojeći (rade preko izvršitelja) i planirani. `vrsta`: 'ai' (Claude), 'pravila' (izračun ploče bez AI-ja), 'planiran'. */
  var AGENTI = [
    { id: 'koordinator', kod: 'KO', naziv: 'Koordinator', odjeli: ['uprava'], vrsta: 'ai', opis: 'Tjedni sažetak za upravu i odluke za tebe. Postaje jedini sugovornik (razgovor na ploči dolazi u idućem koraku).' },
    { id: 'konkurencija', kod: 'KN', naziv: 'Konkurencija', odjeli: ['prodaja', 'mreze'], vrsta: 'ai', opis: 'Cijene i ponuda drugih. Način traženja konkurencije se redefinira.' },
    { id: 'seo', kod: 'SE', naziv: 'SEO', odjeli: ['mreze', 'web'], vrsta: 'ai', opis: 'Ključne riječi i Google.' },
    { id: 'ai', kod: 'AI', naziv: 'AI vidljivost', odjeli: ['mreze'], vrsta: 'ai', opis: 'Spominju li nas AI asistenti.' },
    { id: 'sadrzaj', kod: 'SA', naziv: 'Sadržaj', odjeli: ['mreze'], vrsta: 'ai', opis: 'Objave, vodiči i tekstovi.' },
    { id: 'lokalno', kod: 'LO', naziv: 'Lokalno', odjeli: ['mreze', 'prodaja'], vrsta: 'ai', opis: 'Recenzije, partneri i lokalni imenici.' },
    { id: 'materijal', kod: 'NA', naziv: 'Nabava', odjeli: ['proizvodnja', 'financije'], vrsta: 'ai', opis: 'Potrošni materijal i cijene kod dobavljača.' },
    { id: 'oglasi', kod: 'OG', naziv: 'Oglasi', odjeli: ['mreze'], vrsta: 'ai', opis: 'Uključuje se u ožujku 2027.' },
    { id: 'claude', kod: 'CL', naziv: 'Opći zadatak', odjeli: ['web'], vrsta: 'ai', opis: 'Opći zadatak; promjene stranice radi Claude Code kao pull request.' },
    { id: 'planer', kod: 'PL', naziv: 'Planer narudžbi', odjeli: ['prodaja', 'proizvodnja'], vrsta: 'pravila', opis: 'Kalendar, kapacitet šivanja i upozorenja na rokove i naplatu. Izračun ploče, bez troška.' },
    { id: 'skladiste', kod: 'SK', naziv: 'Skladište', odjeli: ['proizvodnja'], vrsta: 'pravila', opis: 'Stanje tkanina i koliko slova još može. Izračun ploče, bez troška.' },
    { id: 'analiticar', kod: 'AM', naziv: 'Analitičar mreža', odjeli: ['mreze'], vrsta: 'pravila', opis: 'Brojke s Instagrama i Facebooka i zaključci iz njih. Za sad izračun ploče; tjedni sažetak agenta dolazi kasnije.' },
    { id: 'upiti', kod: 'UP', naziv: 'Upiti', odjeli: ['prodaja'], vrsta: 'planiran', opis: 'Broji upite iz Gmaila i poruka. Kreće kad se spoji Gmail.' },
    { id: 'trendovi', kod: 'TR', naziv: 'Trendovi', odjeli: ['mreze'], vrsta: 'planiran', opis: 'Što raste kod sličnih računa.' },
    { id: 'kreator', kod: 'KS', naziv: 'Kreator sadržaja', odjeli: ['mreze'], vrsta: 'planiran', opis: 'Ideje i kratki videi iz konfiguratora.' },
    { id: 'financije', kod: 'FI', naziv: 'Financije', odjeli: ['financije', 'uprava'], vrsta: 'planiran', opis: 'Troškovi s izvoda banke, dobit i marža. Kreće kad se spoje izvodi.' },
    { id: 'web', kod: 'RS', naziv: 'Razvoj stranice', odjeli: ['web'], vrsta: 'planiran', opis: 'Prijedlozi izmjena stranice kao pull request.' }
  ];
  var AG = {}; AGENTI.forEach(function (a) { AG[a.id] = a; });
  function odjelAgenta(id) { return (AG[id] && AG[id].odjeli[0]) || 'uprava'; }

  function aktivno() {
    var p = location.pathname.replace(/\/index\.html$/, '/'), h = location.hash.slice(1);
    if (p === '/') {
      if (['svi', 'odluke', 'zadaci'].indexOf(h) >= 0) return 'svi';
      if (h === 'agenti') return 'agenti';
      if (h === 'brojke' || h === 'konkurencija') return 'prodaja';
      if (h === 'napredak') return 'mreze';
      return 'pregled';
    }
    var m = { '/prodaja.html': 'prodaja', '/skladiste.html': 'proizvodnja', '/mreze.html': 'mreze', '/financije.html': 'financije', '/web.html': 'web', '/kalendar.html': 'kalendar', '/izvori.html': 'izvori' };
    return m[p] || '';
  }
  function crtaj() {
    var a = aktivno();
    function veza(id, naziv, href, ik) { return '<a href="' + href + '"' + (a === id ? ' aria-current="page"' : '') + '>' + ikona(ik) + '<span>' + naziv + '</span></a>'; }
    var el = document.getElementById('bocna-nav');
    if (!el) return;
    el.innerHTML = '<span class="nav-grupa">Uprava</span>' + veza('pregled', 'Pregled', '/', 'pregled') +
      '<span class="nav-grupa">Odjeli</span>' + ODJELI.map(function (o) { return veza(o.id, o.naziv, o.href, o.id); }).join('') +
      '<span class="nav-grupa">Zajedničko</span>' + veza('kalendar', 'Kalendar', '/kalendar.html', 'kalendar') + veza('svi', 'Svi zadaci', '/#svi', 'zadaci') +
      veza('agenti', 'Agenti', '/#agenti', 'agenti') + veza('izvori', 'Izvori i pravila', '/izvori.html', 'izvori');
  }
  function umetni() {
    if (document.getElementById('bocna')) return;
    var as = document.createElement('aside');
    as.className = 'bocna'; as.id = 'bocna'; as.setAttribute('aria-label', 'Odjeli');
    as.innerHTML = '<a class="marka" href="/"><span class="marka-znak" aria-hidden="true">P</span><span><b>Piccolini Play</b><span>Ploča tvrtke</span></span></a><nav class="bocna-nav" id="bocna-nav"></nav>';
    document.body.insertBefore(as, document.body.firstChild);
    crtaj();
  }
  document.documentElement.classList.add('ima-bocnu');
  if (document.body) umetni(); else document.addEventListener('DOMContentLoaded', umetni);
  window.addEventListener('hashchange', crtaj);

  window.PL = { ODJELI: ODJELI, NAZIV_ODJELA: NAZIV_ODJELA, AGENTI: AGENTI, AG: AG, odjelAgenta: odjelAgenta, ikona: ikona };
})();
