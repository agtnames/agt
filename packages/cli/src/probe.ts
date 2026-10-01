/**
 * Read what an agent says about itself (RATIONALE R-3): an MCP server's name, instructions and tools over Streamable
 * HTTP, or an A2A agent card's description and skills. Read-only, short timeouts, and only for endpoints the user
 * just entered. The result feeds the description prefill and the capability suggestions.
 */

export interface SelfDescription {
  protocol: string;
  url: string;
  live: boolean;
  name?: string;
  description?: string;
  items: { kind: "tool" | "skill"; name: string; description?: string; tags?: string[]; inputSchema?: unknown }[];
  error?: string;
}

const TIMEOUT = 8000;

async function rpc(url: string, body: unknown, session: string | null, fetchImpl: typeof fetch): Promise<{ result: any; session: string | null }> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
  if (session) headers["mcp-session-id"] = session;
  const r = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
  const sid = r.headers.get("mcp-session-id") ?? session;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = r.headers.get("content-type") ?? "";
  const text = await r.text();
  let msg: any;
  if (type.includes("text/event-stream")) {
    const data = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    msg = data.map((d) => { try { return JSON.parse(d); } catch { return null; } }).find((m) => m && "id" in m && m.id === (body as { id?: number }).id);
  } else msg = text ? JSON.parse(text) : null;
  if (!msg) throw new Error("no JSON-RPC response");
  if (msg.error) throw new Error(msg.error.message ?? "JSON-RPC error");
  return { result: msg.result, session: sid };
}

export async function probeMcp(url: string, fetchImpl: typeof fetch = fetch): Promise<SelfDescription> {
  try {
    const init = await rpc(url, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agt-cli", version: "0" } } }, null, fetchImpl);
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (init.session) headers["mcp-session-id"] = init.session;
    await fetchImpl(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), signal: AbortSignal.timeout(TIMEOUT) }).then((r) => r.body?.cancel()).catch(() => {});
    const tools = await rpc(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, init.session, fetchImpl).catch(() => ({ result: { tools: [] } }));
    const info = init.result?.serverInfo ?? {};
    return {
      protocol: "mcp", url, live: true,
      name: info.title ?? info.name,
      description: typeof init.result?.instructions === "string" ? firstSentence(init.result.instructions) : info.description,
      items: (tools.result?.tools ?? []).map((t: any) => ({ kind: "tool" as const, name: String(t.name), description: t.description, inputSchema: t.inputSchema })),
    };
  } catch (e) {
    return { protocol: "mcp", url, live: false, items: [], error: (e as Error).message };
  }
}

export async function probeA2a(url: string, fetchImpl: typeof fetch = fetch): Promise<SelfDescription> {
  let origin: string;
  try { origin = new URL(url).origin; } catch { return { protocol: "a2a", url, live: false, items: [], error: "not a URL" }; }
  const candidates = url.endsWith(".json") ? [url] : [`${origin}/.well-known/agent-card.json`, `${origin}/.well-known/agent.json`];
  let lastError = "no agent card";
  for (const c of candidates) {
    try {
      const r = await fetchImpl(c, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!r.ok) { lastError = `HTTP ${r.status}`; continue; }
      const card = await r.json() as any;
      return {
        protocol: "a2a", url, live: true, name: card.name, description: card.description,
        items: (card.skills ?? []).map((s: any) => ({ kind: "skill" as const, name: String(s.name ?? s.id), description: s.description, tags: Array.isArray(s.tags) ? s.tags : undefined })),
      };
    } catch (e) { lastError = (e as Error).message; }
  }
  return { protocol: "a2a", url, live: false, items: [], error: lastError };
}

export async function probeHttp(url: string, fetchImpl: typeof fetch = fetch): Promise<SelfDescription> {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT) });
    await r.body?.cancel().catch(() => {});
    return { protocol: "http", url, live: r.status < 500, items: [], error: r.status < 500 ? undefined : `HTTP ${r.status}` };
  } catch (e) { return { protocol: "http", url, live: false, items: [], error: (e as Error).message }; }
}

export function probe(protocol: string, url: string, fetchImpl: typeof fetch = fetch): Promise<SelfDescription> {
  if (protocol === "mcp") return probeMcp(url, fetchImpl);
  if (protocol === "a2a") return probeA2a(url, fetchImpl);
  return probeHttp(url, fetchImpl);
}

function firstSentence(s: string): string {
  const t = s.trim().split(/\r?\n/)[0];
  const m = /^(.{20,200}?[.!?])(\s|$)/.exec(t);
  return (m ? m[1] : t).slice(0, 200);
}
