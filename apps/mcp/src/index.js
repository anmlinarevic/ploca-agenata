/* MCP server „ploča” (Streamable HTTP, bez stanja). Korak 1: samo alati za čitanje.
 * Zakupac i agent dolaze isključivo iz tokena; tenant_id se nikad ne čita iz zahtjeva. */
import { TOOLS, pozoviAlat } from './alati.js';

const PROTOCOL = '2025-03-26';
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const rpcGreska = (id, code, message) => json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Vraća {tenantId, agent, dopusteni} ili null. */
async function autentificiraj(request, env) {
  const m = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  const hash = await sha256Hex((env.TOKEN_PEPPER || '') + m[1]);
  const red = await env.DB.prepare(
    `SELECT tenant_id, agent, dopusteni_alati, istice FROM agent_tokeni
     WHERE hash = ? AND opozvan = 0`,
  ).bind(hash).first();
  if (!red) return null;
  if (red.istice && red.istice < new Date().toISOString()) return null;
  const dopusteni = red.dopusteni_alati === '*' ? null : new Set(red.dopusteni_alati.split(',').map((s) => s.trim()));
  return { tenantId: red.tenant_id, agent: red.agent, dopusteni };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname !== '/mcp') return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });

    const ctx = await autentificiraj(request, env);
    if (!ctx) return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } });

    let msg;
    try { msg = await request.json(); } catch { return rpcGreska(null, -32700, 'Neispravan JSON'); }
    if (Array.isArray(msg) || typeof msg !== 'object' || !msg) return rpcGreska(null, -32600, 'Podržan je jedan zahtjev po pozivu');

    const { id, method, params } = msg;
    if (id === undefined) return new Response(null, { status: 202 }); // notifikacija

    switch (method) {
      case 'initialize':
        return json({ jsonrpc: '2.0', id, result: {
          protocolVersion: PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'ploca', version: '0.1.0' },
        } });
      case 'ping':
        return json({ jsonrpc: '2.0', id, result: {} });
      case 'tools/list': {
        const alati = TOOLS.filter((t) => !ctx.dopusteni || ctx.dopusteni.has(t.name))
          .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
        return json({ jsonrpc: '2.0', id, result: { tools: alati } });
      }
      case 'tools/call': {
        const ime = params?.name;
        const alat = TOOLS.find((t) => t.name === ime);
        if (!alat) return rpcGreska(id, -32602, `Nepoznat alat: ${ime}`);
        if (ctx.dopusteni && !ctx.dopusteni.has(ime)) return rpcGreska(id, -32602, `Token ne dopušta alat: ${ime}`);
        try {
          const rezultat = await pozoviAlat(alat, params.arguments || {}, ctx, env);
          return json({ jsonrpc: '2.0', id, result: {
            content: [{ type: 'text', text: JSON.stringify(rezultat) }],
          } });
        } catch (e) {
          return json({ jsonrpc: '2.0', id, result: {
            isError: true, content: [{ type: 'text', text: String(e.message || e) }],
          } });
        }
      }
      default:
        return rpcGreska(id, -32601, `Nepoznata metoda: ${method}`);
    }
  },
};
