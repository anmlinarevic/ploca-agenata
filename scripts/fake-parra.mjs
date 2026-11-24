// Lažni Parra API (v1.1) za lokalne testove i demo: ponude, detalji, računi. Oblik odgovora prema https://api.parra.hr/openapi/v1.1.json.
// Ključ: Bearer test-parra, subjekt 123. Upravljanje testom: POST /prihvati/:id, POST /pokvari, POST /popravi, GET /zahtjevi.
import http from 'node:http';

const port = Number(process.env.PORT || 8791);
const D = (k) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb' }).format(new Date(Date.now() + k * 86400000));
let sat = 0;
const kad = () => new Date(Date.UTC(2026, 10, 1, 8, 0, sat++)).toISOString();
const zahtjevi = [];
let pokvareno = false;

const kupac = { customerType: { value: 1, name: 'Person' }, name: 'Ana Anić', oibOrVatId: '12345678901', addressWithNo: 'Ulica 1', cityName: 'Dugo Selo', contactEmail: 'ana@primjer.hr', contactPhone: '091 234 5678' };
const ponuda = (id, status, isporuka, linije, iznos, racuni = []) => ({
  id, uniqueIdentifier: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`, status: { value: 1, name: status, description: null }, isSent: true,
  customer: kupac,
  basicInfo: { ordinalNumber: id, offerNumber: `${id}-1-1`, offerDate: `${D(-7)}T10:00:00`, expirationDate: D(20), currencyMark: 'EUR' },
  deliveryInfo: isporuka,
  offerLines: linije.map(([name, quantity, priceAmount]) => ({ name, quantity, priceAmount, unitOfMeasureMark: 'H87', description: 'LUCIJA, roza i menta' })),
  totalAmount: iznos, invoices: racuni.map((r) => ({ invoiceId: r, invoiceNumber: `${r}-1-1`, status: { value: 2, name: 'Final' } })),
  createdOn: kad(), modifiedOn: null,
});
const jedan = (d) => ({ isDeliveryPeriod: false, deliveryDate: d });
const ponude = [
  ponuda(101, 'Issued', jedan(D(3)), [['Banner s imenom, po slovu', 6, 15]], 90),
  ponuda(102, 'Accepted', jedan(D(5)), [['Banner s imenom, po slovu', 4, 15], ['BoxNow dostava', 1, 4]], 64, [9001]),
  ponuda(103, 'Accepted', { isDeliveryPeriod: true, deliveryDateFrom: D(10), deliveryDateTo: D(12) }, [['Najam igraonice, vikend', 1, 180]], 180),
  ponuda(104, 'Denied', jedan(D(4)), [['Banner s imenom, po slovu', 3, 15]], 45),
  ponuda(105, 'Accepted', jedan(D(-3)), [['Tiha knjiga', 1, 40]], 40, [9002]),
  ponuda(106, 'Issued', { isDeliveryPeriod: false, deliveryDate: null }, [['Banner s imenom, po slovu', 5, 15]], 75),
];
const racuni = [
  { id: 9001, invoiceNumber: '9001-1-1', documentDateInCet: `${D(-2)}T09:00:00`, dueDate: D(5), customerName: kupac.name, totalAmount: 64, paidAmount: 64, status: 'Paid' },
  { id: 9002, invoiceNumber: '9002-1-1', documentDateInCet: `${D(-4)}T09:00:00`, dueDate: D(4), customerName: kupac.name, totalAmount: 40, paidAmount: 0, status: 'Final' },
];
const promjena = (p) => p.modifiedOn || p.createdOn;
const listaj = (p) => ({ id: p.id, offerNumber: p.basicInfo.offerNumber, status: p.status, offerDate: p.basicInfo.offerDate, customerName: p.customer.name,
  totalAmount: p.totalAmount, linkedInvoiceIds: p.invoices.map((i) => i.invoiceId), createdOn: p.createdOn, modifiedOn: p.modifiedOn });

const posalji = (res, status, tijelo) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(tijelo)); };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/zahtjevi') return posalji(res, 200, { broj: zahtjevi.length, zadnji: zahtjevi.slice(-10) });
  if (req.method === 'POST' && u.pathname === '/pokvari') { pokvareno = true; return posalji(res, 200, {}); }
  if (req.method === 'POST' && u.pathname === '/popravi') { pokvareno = false; return posalji(res, 200, {}); }
  let m;
  if (req.method === 'POST' && (m = /^\/prihvati\/(\d+)$/.exec(u.pathname))) {
    const p = ponude.find((x) => x.id === +m[1]); p.status = { value: 2, name: 'Accepted' }; p.modifiedOn = kad(); return posalji(res, 200, {});
  }
  zahtjevi.push(req.method + ' ' + u.pathname + u.search);
  if (pokvareno || req.headers.authorization !== 'Bearer test-parra') return posalji(res, 401, { title: 'Unauthorized', errorCode: 'Parra.ApiKeyInvalid' });
  if (req.method !== 'GET') return posalji(res, 405, {});

  if (u.pathname === '/v1.1/123/offers') {
    const od = u.searchParams.get('UpdatedSince'), poslije = u.searchParams.get('AfterId');
    const size = +(u.searchParams.get('pageSize') || 20);
    let l = [...ponude].sort((a, b) => (promjena(a) < promjena(b) ? -1 : promjena(a) > promjena(b) ? 1 : a.id - b.id));
    if (od) l = l.filter((p) => promjena(p) > od || (promjena(p) === od && (poslije == null || p.id > +poslije)));
    return posalji(res, 200, { success: true, data: l.slice(0, size).map(listaj), pagination: { page: 1, pageSize: size, totalCount: l.length, totalPages: Math.ceil(l.length / size) } });
  }
  if ((m = /^\/v1\.1\/123\/offers\/(\d+)$/.exec(u.pathname))) {
    const p = ponude.find((x) => x.id === +m[1]);
    return p ? posalji(res, 200, p) : posalji(res, 404, { errorCode: 'Parra.ResourceNotFound' });
  }
  if (u.pathname === '/v1.1/123/invoices') return posalji(res, 200, { success: true, data: racuni, pagination: { page: 1, pageSize: 50, totalCount: racuni.length, totalPages: 1 } });
  return posalji(res, 404, { errorCode: 'Parra.ResourceNotFound' });
}).listen(port, () => console.log(`Lažni Parra na http://localhost:${port}`));
