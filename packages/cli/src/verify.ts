/**
 * verify: the three-way check (manifest signer == manifest owner == on-chain owner) from @agtnames/resolver, plus a
 * liveness probe of every on-chain endpoint. An endpoint is live when `<origin>/health` answers 2xx, or, failing
 * that, when the endpoint URL itself answers below 500 (an MCP endpoint answers GET with 405 or 406, which is alive).
 */
import { AgtResolver, type AgentResolution } from "@agtnames/resolver";
import type { Network } from "./config.js";

export interface EndpointCheck { protocol: string; url: string; live: boolean; via: "health" | "endpoint" | null; status: number | null; error?: string }

export interface VerifyReport {
  name: string;
  ok: boolean;
  verified: boolean;
  manifestStatus: AgentResolution["manifestStatus"];
  owner: string | null;
  signer: string | null;
  manifestUri: string;
  reasons: string[];
  endpoints: EndpointCheck[];
  problems: string[];
}

async function probe(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<number | null> {
  try {
    const r = await fetchImpl(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json, text/event-stream, */*" } });
    await r.body?.cancel().catch(() => {});
    return r.status;
  } catch { return null; }
}

export async function checkEndpoint(protocol: string, url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<EndpointCheck> {
  let origin: string;
  try { origin = new URL(url).origin; } catch { return { protocol, url, live: false, via: null, status: null, error: "not a URL" }; }
  const h = await probe(`${origin}/health`, fetchImpl, timeoutMs);
  if (h !== null && h >= 200 && h < 300) return { protocol, url, live: true, via: "health", status: h };
  const e = await probe(url, fetchImpl, timeoutMs);
  if (e !== null && e < 500) return { protocol, url, live: true, via: "endpoint", status: e };
  return { protocol, url, live: false, via: null, status: e ?? h, error: e === null && h === null ? "no response" : `HTTP ${e ?? h}` };
}

export async function verifyName(n: Network, label: string, opts: { fetchImpl?: typeof fetch; skipEndpoints?: boolean } = {}): Promise<VerifyReport> {
  const resolver = new AgtResolver({ chain: n.name, rpcUrls: n.rpcUrls, registry: n.registry });
  const r = await resolver.resolveAgent(`${label}.agt`);
  const onchain = Object.entries(r.records.endpoints);
  const endpoints = opts.skipEndpoints ? [] : await Promise.all(onchain.map(([p, u]) => checkEndpoint(p, u, opts.fetchImpl)));
  const problems: string[] = [];
  if (!r.registered) problems.push("not registered");
  else if (!r.active) problems.push("registered but not active (expired?)");
  if (r.registered && r.manifestStatus === "none") problems.push("no manifest published (run `agt manifest publish`)");
  if (r.manifestStatus === "unavailable") problems.push("the manifest pointer is set but no gateway returned the document (transport; retry later)");
  if (r.manifestStatus === "unverified") problems.push(`manifest does not verify: ${r.reasons.join("; ")}`);
  const declared = new Map((r.manifest?.endpoints ?? []).map((e) => [e.protocol, e.url]));
  for (const [p, u] of declared) if (r.records.endpoints[p] !== undefined && r.records.endpoints[p] !== u) problems.push(`endpoint ${p}: manifest says ${u}, on-chain record says ${r.records.endpoints[p]}`);
  for (const [p, u] of declared) if (r.records.endpoints[p] === undefined && ["mcp", "a2a", "http", "ws"].includes(p)) problems.push(`endpoint ${p} (${u}) is in the manifest but not on-chain (run \`agt records set\`)`);
  for (const e of endpoints) if (!e.live) problems.push(`endpoint ${e.protocol} ${e.url} is not reachable (${e.error})`);
  return {
    name: `${label}.agt`,
    ok: problems.length === 0 && r.verified,
    verified: r.verified,
    manifestStatus: r.manifestStatus,
    owner: r.owner,
    signer: r.signer,
    manifestUri: r.records.manifestUri,
    reasons: r.reasons,
    endpoints,
    problems,
  };
}
