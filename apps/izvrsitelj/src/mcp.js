/* Klijent MCP servera „ploča” preko service bindinga (env.MCP). Agent piše samo ovuda, nikad izravno u bazu.
 * Token određuje zakupca i agenta; izvršitelj zakupca ne šalje nigdje drugdje. */
export function mcpKlijent(env, token) {
  let id = 0;
  async function rpc(method, params) {
    const r = await env.MCP.fetch('https://ploca-mcp/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    if (!r.ok) throw new Error(`MCP odgovor ${r.status}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.result;
  }
  return {
    alati: async () => (await rpc('tools/list', {})).tools,
    pozovi: async (ime, argumenti) => {
      const res = await rpc('tools/call', { name: ime, arguments: argumenti || {} });
      return { tekst: (res.content || []).map((c) => c.text).join('\n'), greska: !!res.isError };
    },
  };
}
