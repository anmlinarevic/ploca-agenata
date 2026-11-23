/* Zajedničko za Kalendar i Skladište: API s izborom zakupca (savjetnik), escape, oblikovanje brojeva i datuma. */
(function () {
  var TENANT = null;
  try { TENANT = localStorage.getItem('tenant'); } catch (e) {}
  function api(metoda, put, tijelo) {
    var h = {};
    if (tijelo !== undefined) h['content-type'] = 'application/json';
    if (TENANT) h['x-tenant'] = TENANT;
    return fetch(put, { method: metoda, headers: h, credentials: 'same-origin', body: tijelo !== undefined ? JSON.stringify(tijelo) : undefined })
      .then(function (r) {
        return r.text().then(function (t) {
          var d = {}; try { d = JSON.parse(t); } catch (e) {}
          if (!r.ok) {
            var e = new Error(d.greska || (r.status === 401 || r.status === 403 ? 'Nemaš pristup. Osvježi stranicu i prijavi se ponovno.' : 'Greška ' + r.status));
            e.status = r.status; throw e;
          }
          return d;
        });
      });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function broj(x, d) { if (x == null) return '–'; return Number(x).toLocaleString('hr-HR', { minimumFractionDigits: 0, maximumFractionDigits: d == null ? 2 : d }); }
  function kolicina(x, j) { return broj(x, j === 'm2' ? 2 : 1) + ' ' + (j === 'm2' ? 'm²' : j); }
  var DANI = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];
  function datum(d) { if (!d) return ''; var p = d.slice(0, 10).split('-'); return +p[2] + '. ' + +p[1] + '.'; }
  function danUTjednu(d) { return DANI[new Date(d.slice(0, 10) + 'T12:00:00Z').getUTCDay()]; }
  function dodajDane(d, k) { var x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); }
  function poruka(el, tekst, vrsta) { el.textContent = tekst || ''; el.className = 'poruka' + (vrsta ? ' ' + vrsta : ''); }
  // Savjetnik bira zakupca na glavnoj ploči; ovdje se samo prikazuje.
  api('GET', '/api/ja').then(function (ja) {
    var t = ja.tenanti.filter(function (x) { return x.id === (TENANT || (ja.tenanti[0] && ja.tenanti[0].id)); })[0];
    var el = document.getElementById('zakupac');
    if (t && el) el.textContent = t.naziv;
  }).catch(function () {});
  window.P = { api: api, esc: esc, broj: broj, kolicina: kolicina, datum: datum, danUTjednu: danUTjednu, dodajDane: dodajDane, poruka: poruka };
})();
