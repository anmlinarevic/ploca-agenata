// Lažna Meta (Graph API) za testove bez wranglera: dvije Facebook stranice (555111, 556222) s Instagram računima 777 i 778.
// Dnevni uvidi (period=day) vraćaju niz po danu; end_time je kraj dana (sljedeće jutro u 08:00 UTC), kao u pravoj Meti.
/** Vrijednost dnevne metrike za dan (broj dana od 1970.), da test zna što očekuje. Dan ide s mjerom i skalom računa. */
export const vrijednostDana = (metrika, dan, skala = 1) => ({ reach: 100, views: 300, page_total_media_view_unique: 50, page_media_view: 150 }[metrika] ?? 1) * skala + (dan % 5);

/** Lažna Meta (Graph API) s dvije stranice i dva Instagram računa. */
export function laznaMeta() {
  const stranice = {
    555111: { ime: 'Piccolini Play', fol: 842, igId: '777', igIme: 'piccoliniplay', igFol: 1284, token: 'str-555', skala: 1 },
    556222: { ime: 'Piccolini Šivanje', fol: 310, igId: '778', igIme: 'piccolini.sivanje', igFol: 1912, token: 'str-556', skala: 2 },
  };
  const stanje = { istekao: false, nepostojeca: new Set(), bezViewsDnevno: false, zahtjeva: 0 };
  const kad = (dana) => new Date(Date.now() - dana * 86400000).toISOString().replace('.000Z', '+0000');
  const odg = (status, tijelo) => ({ ok: status < 400, status, json: async () => tijelo });
  const greska = (status, code, message) => odg(status, { error: { message, code } });
  const fetchFn = async (url, opts = {}) => {
    stanje.zahtjeva++;
    const u = new URL(url), put = u.pathname.replace(/^\/v25\.0\//, ''), auth = opts.headers?.authorization;
    const metrike = (u.searchParams.get('metric') || '').split(',').filter(Boolean);
    if (stanje.istekao) return greska(400, 190, 'Error validating access token: Session has expired.');
    // Dnevni uvidi (period=day bez metric_type): niz po danu, end_time je kraj dana.
    if (u.searchParams.get('period') === 'day' && !u.searchParams.get('metric_type') && /\/insights$/.test(put)) {
      const id = put.split('/')[0], igS = Object.values(stranice).find((s) => s.igId === id), fbS = stranice[id];
      const s = igS || fbS; if (!s) return greska(400, 100, 'nepoznat objekt');
      if (fbS && auth !== `Bearer ${fbS.token}`) return greska(400, 190, '(#190) This method must be called with a Page Access Token');
      stanje.dnevnihZahtjeva = (stanje.dnevnihZahtjeva || 0) + 1;
      if (stanje.bezViewsDnevno && metrike[0] === 'views') return greska(400, 100, '(#100) The metric views does not support period day');
      const od = Math.floor(+u.searchParams.get('since') / 86400), doD = Math.floor(+u.searchParams.get('until') / 86400);
      const values = [];
      for (let dn = od; dn < doD; dn++) values.push({ value: vrijednostDana(metrike[0], dn, s.skala), end_time: `${new Date((dn + 1) * 86400000).toISOString().slice(0, 10)}T08:00:00+0000` });
      return odg(200, { data: [{ name: metrike[0], period: 'day', values }] });
    }
    const str = stranice[put] || Object.values(stranice).find((s) => put.startsWith(`${Object.keys(stranice).find((k) => stranice[k] === s)}/`));
    if (stanje.nepostojeca.has(put)) return greska(400, 803, "(#803) Some of the aliases you requested do not exist");
    if (stranice[put]) {
      const s = stranice[put];
      return odg(200, { name: s.ime, followers_count: s.fol, access_token: s.token, instagram_business_account: { id: s.igId, username: s.igIme, followers_count: s.igFol } });
    }
    const ig = Object.values(stranice).find((s) => put.startsWith(`${s.igId}/`));
    if (ig) {
      if (put.endsWith('/insights')) { const v = { reach: 1000 * ig.skala, views: 2000 * ig.skala, total_interactions: 50, saves: 5, shares: 2 };
        return odg(200, { data: metrike.map((m) => ({ name: m, period: 'day', total_value: { value: v[m] ?? 0 } })) }); }
      if (put.endsWith('/media')) return odg(200, { data: [0, 1, 2].map((i) => ({ id: `${ig.igId}${i}`, caption: `Objava ${ig.igIme} ${i}`, media_type: i === 0 ? 'VIDEO' : 'IMAGE', media_product_type: i === 0 ? 'REELS' : 'FEED', timestamp: kad(3 + i * 10), permalink: `https://instagram.com/p/${ig.igId}${i}`, like_count: 10, comments_count: 1 })) });
    }
    const sIg = Object.values(stranice).find((s) => /^\d+\/insights$/.test(put) && put.startsWith(`${s.igId}`));
    if (str) {
      const s = stranice[Object.keys(stranice).find((k) => put.startsWith(`${k}/`))];
      if (auth !== `Bearer ${s.token}`) return greska(400, 190, '(#190) This method must be called with a Page Access Token');
      if (put.endsWith('/insights')) return odg(200, { data: [{ name: 'page_media_view', values: [{ value: 400 * s.skala }, { value: 700 * s.skala }] }, { name: 'page_total_media_view_unique', values: [{ value: 300 * s.skala }, { value: 500 * s.skala }] }] });
      if (put.endsWith('/posts')) return odg(200, { data: [0, 1].map((i) => ({ id: `${Object.keys(stranice).find((k) => stranice[k] === s)}_9${i}`, message: `FB ${s.ime} ${i}`, created_time: kad(5 + i * 12), status_type: 'added_photos', permalink_url: 'https://facebook.com/x' })) });
    }
    let m;
    if ((m = /^(\w+)\/insights$/.exec(put))) {
      const fbStr = m[1].includes('_') ? stranice[m[1].split('_')[0]] : null;
      if (fbStr) { if (auth !== `Bearer ${fbStr.token}`) return greska(400, 190, '(#190) Page Access Token'); return odg(200, { data: [{ name: 'post_media_view', values: [{ value: 300 }] }, { name: 'post_total_media_view_unique', values: [{ value: 200 }] }, { name: 'post_clicks', values: [{ value: 9 }] }, { name: 'post_reactions_by_type_total', values: [{ value: { like: 7 } }] }] }); }
      const igS = Object.values(stranice).find((s) => m[1].startsWith(s.igId));
      if (igS) return odg(200, { data: [{ name: 'views', values: [{ value: 900 * igS.skala }] }, { name: 'reach', values: [{ value: 700 * igS.skala }] }, { name: 'saved', values: [{ value: 6 }] }, { name: 'shares', values: [{ value: 2 }] }] });
    }
    void sIg;
    return greska(400, 100, `Unsupported get request ${put}`);
  };
  return { fetchFn, stanje };
}


