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
    izvori: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5"/>',
    razgovor: '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>'
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
    { id: 'koordinator', kod: 'KO', naziv: 'Koordinator', odjeli: ['uprava'], vrsta: 'ai', opis: 'Jedini sugovornik: primi tvoju poruku, da posao agentu koji ga može napraviti i javi rezultat. Piše i tjedni sažetak za upravu.' },
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
    { id: 'kreator', kod: 'KS', naziv: 'Kreator objava', odjeli: ['mreze'], vrsta: 'planiran', opis: 'Claude u zakazanim sesijama izrađuje tjedni plan i objave za TikTok; ti ih odobravaš na stranici Objave.' },
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
    var m = { '/prodaja.html': 'prodaja', '/skladiste.html': 'proizvodnja', '/mreze.html': 'mreze', '/objave.html': 'mreze', '/knjiznica.html': 'mreze', '/financije.html': 'financije', '/web.html': 'web', '/kalendar.html': 'kalendar', '/izvori.html': 'izvori' };
    return m[p] || m[p + '.html'] || ''; // hosting skida .html (/mreze.html → /mreze)
  }
  function crtaj() {
    var a = aktivno();
    function veza(id, naziv, href, ik) { return '<a href="' + href + '"' + (a === id ? ' aria-current="page"' : '') + '>' + ikona(ik) + '<span>' + naziv + '</span></a>'; }
    var el = document.getElementById('bocna-nav');
    if (!el) return;
    el.innerHTML = '<span class="nav-grupa">Uprava</span>' + veza('pregled', 'Pregled', '/', 'pregled') +
      '<span class="nav-grupa">Odjeli</span>' + ODJELI.map(function (o) { return veza(o.id, o.naziv, o.href, o.id); }).join('') +
      '<span class="nav-grupa">Zajedničko</span>' + '<button type="button" class="nav-gumb" data-koordinator="">' + ikona('razgovor') + '<span>Koordinator</span></button>' +
      veza('kalendar', 'Kalendar', '/kalendar.html', 'kalendar') + veza('svi', 'Svi zadaci', '/#svi', 'zadaci') +
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

  /* ── Razgovor s koordinatorom: gumb i ladica na svakoj stranici ──
   * Vlasnik piše samo koordinatoru; koordinator daje posao agentima, a obavijesti o gotovom poslu stižu ovdje. */
  var TEN = null;
  try { TEN = localStorage.getItem('tenant'); } catch (e) {}
  function api(metoda, put, tijelo) {
    var h = {};
    if (tijelo !== undefined) h['content-type'] = 'application/json';
    if (TEN) h['x-tenant'] = TEN;
    return fetch(put, { method: metoda, headers: h, credentials: 'same-origin', body: tijelo !== undefined ? JSON.stringify(tijelo) : undefined })
      .then(function (r) {
        return r.text().then(function (t) {
          var d = {}; try { d = JSON.parse(t); } catch (e) {}
          if (!r.ok) throw new Error(d.greska || (r.status === 401 || r.status === 403 ? 'Nemaš pristup. Osvježi stranicu i prijavi se ponovno.' : 'Greška ' + r.status));
          return d;
        });
      });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* Tekst koordinatora: bez HTML-a; **masno** postaje podebljano, oznake naslova (##) se skidaju, retci ostaju. */
  function oblik(t) { return esc(t).replace(/^#+\s*/gm, '').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '$1'); }
  function kad(k) { var d = new Date(k); return isNaN(d) ? '' : d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
  function agenataRadi(n) { return n === 1 ? 'Jedan agent radi' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? n + ' agenta rade' : n + ' agenata radi'; }

  var KO = { otvoren: false, poruke: null, radi: false, agenti: 0, timer: null, salje: false, fokus: null, dolje: true, snimka: null, prepisuje: false };
  // Diktiranje: preglednik samo snima, a govor u tekst pretvara Whisper na Cloudflareu (/api/diktat). Ne ovisi o
  // ugrađenom prepoznavanju govora u pregledniku, koje u Edgeu, Braveu i na tvrtkinim računalima često ne radi.
  var MOZE_SNIMATI = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder && (window.AudioContext || window.webkitAudioContext));
  var MAX_SNIMKA_S = 120;

  function umetniKoordinatora() {
    if (document.getElementById('koord')) return;
    var g = document.createElement('button');
    g.type = 'button'; g.className = 'koord-gumb'; g.id = 'koord-gumb'; g.setAttribute('data-koordinator', '');
    g.innerHTML = ikona('razgovor', 18) + '<span>Koordinator</span><i class="koord-tocka" hidden title="Koordinator ili agent radi"></i>';
    var pr = document.createElement('div'); pr.className = 'koord-prekrivac'; pr.id = 'koord-prekrivac'; pr.hidden = true;
    var as = document.createElement('aside');
    as.className = 'koord'; as.id = 'koord'; as.hidden = true;
    as.setAttribute('role', 'dialog'); as.setAttribute('aria-modal', 'true'); as.setAttribute('aria-labelledby', 'koord-naslov');
    as.innerHTML = '<div class="koord-glava"><div class="red"><h2 id="koord-naslov">Koordinator</h2><button class="btn malo" type="button" id="koord-zatvori">Zatvori</button></div>' +
      '<span class="sitno">Napiši što treba napraviti. Koordinator daje posao agentu koji to može, a kad je gotovo, javlja se ovdje. Ništa se ne objavljuje ni ne šalje bez tebe.</span></div>' +
      '<div class="koord-poruke" id="koord-poruke"></div>' +
      '<form class="koord-unos" id="koord-forma" novalidate><label class="sitno" for="koord-tekst">Poruka koordinatoru</label>' +
      '<textarea id="koord-tekst" placeholder="Npr. Napiši nacrt vodiča o poklonu za krštenje i javi mi kad je gotov."></textarea>' +
      '<div class="koord-dno"><span class="poruka" id="koord-status" aria-live="polite"></span><span class="kontrole">' +
      (MOZE_SNIMATI ? '<button class="btn" type="button" id="koord-govor" aria-pressed="false" title="Snimi govor; tekst se upiše u polje, a šalješ ga ti">Diktiraj</button>' : '') +
      '<button class="btn glavni" type="submit" id="koord-posalji">Pošalji</button></span></div></form>';
    document.body.appendChild(g); document.body.appendChild(pr); document.body.appendChild(as);
    document.getElementById('koord-forma').addEventListener('submit', function (e) { e.preventDefault(); posalji(); });
    document.getElementById('koord-tekst').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); posalji(); }
    });
    document.getElementById('koord-zatvori').addEventListener('click', zatvoriKoordinatora);
    pr.addEventListener('click', zatvoriKoordinatora);
    if (MOZE_SNIMATI) document.getElementById('koord-govor').addEventListener('click', diktiraj);
    ucitajRazgovor();
  }
  function status(t, vrsta) { var el = document.getElementById('koord-status'); if (el) { el.textContent = t || ''; el.className = 'poruka' + (vrsta ? ' ' + vrsta : ''); } }

  function crtajRazgovor() {
    var t = document.querySelector('#koord-gumb .koord-tocka');
    if (t) t.hidden = !(KO.radi || KO.agenti);
    var el = document.getElementById('koord-poruke');
    if (!el || !KO.otvoren) return;
    var h = KO.poruke === null ? '<p class="prazno">Učitavam razgovor…</p>' : KO.poruke.length ? KO.poruke.map(function (m) {
      var tko = m.tko === 'koordinator' ? 'Koordinator · ' : m.tko === 'ploca' ? 'Ploča · ' : '';
      return '<div class="koord-poruka ' + esc(m.tko) + '">' + oblik(m.tekst) + '<span class="kad">' + tko + esc(kad(m.kad)) + '</span></div>';
    }).join('') : '<p class="prazno">Još nema poruka. Napiši što treba napraviti; ne moraš znati koji agent to radi.</p>';
    if (KO.radi) h += '<p class="koord-pise">Koordinator radi…</p>';
    else if (KO.agenti) h += '<p class="koord-pise">' + agenataRadi(KO.agenti) + ' na tvom zadatku. Javit će se ovdje.</p>';
    var naDnu = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    el.innerHTML = h;
    if (naDnu || KO.dolje) { el.scrollTop = el.scrollHeight; KO.dolje = false; }
  }
  function planiraj() {
    clearTimeout(KO.timer);
    var ms = KO.radi ? 3000 : KO.agenti ? (KO.otvoren ? 8000 : 20000) : KO.otvoren ? 30000 : 0;
    if (ms) KO.timer = setTimeout(function () { if (!document.hidden) ucitajRazgovor(); else planiraj(); }, ms);
  }
  function ucitajRazgovor() {
    return api('GET', '/api/razgovor').then(function (d) {
      var bilo = KO.poruke ? KO.poruke.length : -1;
      KO.poruke = d.poruke || []; KO.radi = !!d.koordinatorRadi; KO.agenti = d.agentiRade || 0;
      if (KO.poruke.length !== bilo) KO.dolje = true;
      crtajRazgovor(); planiraj();
      if (bilo >= 0 && KO.poruke.length !== bilo) document.dispatchEvent(new CustomEvent('ploca:razgovor'));
    }).catch(function (e) { status(e.message || 'Razgovor se ne može učitati.', 'greska'); planiraj(); });
  }
  function otvoriKoordinatora(tekst) {
    umetniKoordinatora();
    KO.otvoren = true; KO.dolje = true; KO.fokus = document.activeElement;
    document.getElementById('koord').hidden = false; document.getElementById('koord-prekrivac').hidden = false;
    document.documentElement.classList.add('koord-otvoren');
    var ta = document.getElementById('koord-tekst');
    if (tekst) ta.value = tekst;
    crtajRazgovor(); ucitajRazgovor();
    ta.focus();
  }
  function zatvoriKoordinatora() {
    var as = document.getElementById('koord');
    if (!as || as.hidden) return;
    zaustaviSnimanje(true);
    KO.otvoren = false; as.hidden = true; document.getElementById('koord-prekrivac').hidden = true;
    document.documentElement.classList.remove('koord-otvoren');
    planiraj();
    if (KO.fokus && KO.fokus.focus) KO.fokus.focus();
  }
  function posalji() {
    var ta = document.getElementById('koord-tekst'), gumb = document.getElementById('koord-posalji'), t = ta.value.trim();
    if (KO.salje) return;
    if (KO.snimka || KO.prepisuje) { status('Prvo klikni „Gotovo” i pričekaj da se tekst upiše.', 'greska'); return; }
    if (!t) { status('Napiši poruku.', 'greska'); ta.focus(); return; }
    KO.salje = true; gumb.disabled = true; status('Šaljem…');
    api('POST', '/api/razgovor', { tekst: t.slice(0, 4000) }).then(function (d) {
      ta.value = ''; status(d.greska || '', d.greska ? 'greska' : ''); KO.dolje = true;
      return ucitajRazgovor();
    }).catch(function (e) { status(e.message || 'Poruka nije poslana. Pokušaj ponovno.', 'greska'); })
      .then(function () { KO.salje = false; gumb.disabled = false; });
  }
  /* Diktiranje u tri koraka: snimi (MediaRecorder) → pretvori u WAV 16 kHz mono (Whisper ga sigurno čita) → /api/diktat.
   * Tekst se dopisuje u polje; poruku šalješ ti, tek na „Pošalji”. */
  function gumbGovor(tekst, pritisnut, iskljucen) {
    var g = document.getElementById('koord-govor');
    if (!g) return;
    g.textContent = tekst; g.setAttribute('aria-pressed', pritisnut ? 'true' : 'false'); g.disabled = !!iskljucen;
  }
  function diktiraj() {
    if (KO.snimka) { zaustaviSnimanje(false); return; }
    if (KO.prepisuje) return;
    status('Otvaram mikrofon…');
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (tok) {
      var dijelovi = [], rec = new MediaRecorder(tok), pocetak = Date.now();
      var s = { rec: rec, tok: tok, odbaci: false };
      s.sat = setInterval(function () {
        var sek = Math.round((Date.now() - pocetak) / 1000);
        status('Snimam ' + Math.floor(sek / 60) + ':' + ('0' + sek % 60).slice(-2) + ' · pričaj, pa klikni „Gotovo”.');
        if (sek >= MAX_SNIMKA_S) zaustaviSnimanje(false);
      }, 500);
      rec.ondataavailable = function (e) { if (e.data && e.data.size) dijelovi.push(e.data); };
      rec.onstop = function () {
        tok.getTracks().forEach(function (t) { t.stop(); });
        if (!s.odbaci) prepisi(new Blob(dijelovi, { type: rec.mimeType || 'audio/webm' }));
      };
      KO.snimka = s;
      rec.start(1000);
      gumbGovor('Gotovo', true, false);
      status('Snimam 0:00 · pričaj, pa klikni „Gotovo”.');
    }).catch(function (e) {
      status(e && e.name === 'NotAllowedError' ? 'Preglednik nema dopuštenje za mikrofon. Dopusti ga kod ikone lokota u adresnoj traci.'
        : e && e.name === 'NotFoundError' ? 'Preglednik ne vidi nijedan mikrofon.' : 'Mikrofon se ne može otvoriti: ' + ((e && e.message) || 'nepoznata greška') + '.', 'greska');
    });
  }
  /* odbaci = true kad se ladica zatvori usred snimanja: snimka se ne šalje. */
  function zaustaviSnimanje(odbaci) {
    var s = KO.snimka;
    if (!s) return;
    KO.snimka = null; s.odbaci = !!odbaci; clearInterval(s.sat);
    if (s.rec.state !== 'inactive') s.rec.stop(); else s.tok.getTracks().forEach(function (t) { t.stop(); });
    gumbGovor('Diktiraj', false, !odbaci);
    if (odbaci) status('');
  }
  function prepisi(blob) {
    var ta = document.getElementById('koord-tekst'), Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx();
    KO.prepisuje = true; gumbGovor('Diktiraj', false, true); status('Pretvaram govor u tekst…');
    var BEZ_ZVUKA = 'Snimka nema zvuka: mikrofon ne daje signal. Provjeri koji je mikrofon odabran u pregledniku (ikona lokota u adresnoj traci) ili u Windowsima.';
    (blob.size < 500 ? Promise.reject(new Error(BEZ_ZVUKA)) : blob.arrayBuffer())
      .then(function (buf) { return ctx.decodeAudioData(buf).catch(function () { throw new Error(BEZ_ZVUKA); }); })
      .then(function (zvuk) { ctx.close(); return uWav(zvuk); })
      .then(function (wav) {
        if (wav.tiho) throw new Error(BEZ_ZVUKA);
        if (wav.sekundi < 0.6) throw new Error('Snimka je prekratka. Klikni „Diktiraj”, pričaj, pa „Gotovo”.');
        return api('POST', '/api/diktat', { audio: wav.base64 });
      })
      .then(function (d) {
        var t = (d.tekst || '').trim();
        if (!t) { status('Nisam razumio ništa. Pokušaj ponovno, malo bliže mikrofonu.', 'greska'); return; }
        ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, ' ') : '') + t;
        status('Tekst je upisan. Provjeri ga i klikni „Pošalji”.', 'ok');
        ta.focus();
      })
      .catch(function (e) { try { ctx.close(); } catch (x) { /* već zatvoren */ } status((e && e.message) || 'Diktiranje nije uspjelo.', 'greska'); })
      .then(function () { KO.prepisuje = false; gumbGovor('Diktiraj', false, false); });
  }
  /* Zvuk preglednika → mono 16 kHz, 16-bitni PCM WAV u base64. Javlja i je li snimka tiha (krivi mikrofon). */
  function uWav(zvuk) {
    var HZ = 16000, n = Math.max(1, Math.ceil(zvuk.duration * HZ));
    var Off = window.OfflineAudioContext || window.webkitOfflineAudioContext, off = new Off(1, n, HZ);
    var izvor = off.createBufferSource(); izvor.buffer = zvuk; izvor.connect(off.destination); izvor.start(0);
    return off.startRendering().then(function (r) {
      var uz = r.getChannelData(0), vrh = 0, i;
      var bajtovi = new Uint8Array(44 + uz.length * 2), dv = new DataView(bajtovi.buffer);
      function pisi(o, s) { for (var k = 0; k < s.length; k++) dv.setUint8(o + k, s.charCodeAt(k)); }
      pisi(0, 'RIFF'); dv.setUint32(4, 36 + uz.length * 2, true); pisi(8, 'WAVE'); pisi(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, HZ, true);
      dv.setUint32(28, HZ * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); pisi(36, 'data'); dv.setUint32(40, uz.length * 2, true);
      for (i = 0; i < uz.length; i++) {
        var v = Math.max(-1, Math.min(1, uz[i])); if (Math.abs(v) > vrh) vrh = Math.abs(v);
        dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      }
      var bin = '';
      for (i = 0; i < bajtovi.length; i += 0x8000) bin += String.fromCharCode.apply(null, bajtovi.subarray(i, i + 0x8000));
      return { base64: btoa(bin), sekundi: uz.length / HZ, tiho: vrh < 0.01 };
    });
  }
  document.addEventListener('click', function (e) {
    var k = e.target.closest && e.target.closest('[data-koordinator]');
    if (k) { e.preventDefault(); otvoriKoordinatora(k.getAttribute('data-koordinator') || ''); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && KO.otvoren) zatvoriKoordinatora(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && (KO.otvoren || KO.radi || KO.agenti)) ucitajRazgovor(); });
  if (document.body) umetniKoordinatora(); else document.addEventListener('DOMContentLoaded', umetniKoordinatora);

  window.PL = { ODJELI: ODJELI, NAZIV_ODJELA: NAZIV_ODJELA, AGENTI: AGENTI, AG: AG, odjelAgenta: odjelAgenta, ikona: ikona, otvoriKoordinatora: otvoriKoordinatora };
})();
