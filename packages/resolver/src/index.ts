/**
 * @agtnames/resolver — resolve .agt names against AGT Registry v2 and verify their manifests.
 *
 *   import { AgtResolver } from "@agtnames/resolver";
 *   const agt = new AgtResolver({ chain: "polygon" });                 // or { rpcUrl, registry }
 *   const r = await agt.resolveAgent("exampleagent.agt");
 *   // r.owner, r.active, r.perpetual, r.manifest, r.verified, r.reasons, r.records
 *
 * Resolution order
 *   1. Registry v2 (launch: registry.resolverOf → AGTResolver records; MVP: records on the registry itself)
 *   2. Legacy fallbacks (opt-in): FNS.ownerOf on Polygon (Registry v1 ownership), DNS TXT over DoH (Manifest v1/v2)
 */
import { decAddress, decBool, decBytes, decString, decUint, encString, encUint, labelOf, namehash, normalizeName, selector, tokenIdOf, keccakHex, pad32 } from "./abi.js";
import { CHAINS, chainByName, type ChainConfig } from "./chains.js";
import { cidFromUri, verifyCid, type CidCheck } from "./cid.js";
import { dnsTxt, inlineV1ToManifest } from "./dns.js";
import { fetchManifestBytes, parseManifest, verifyManifest, type AgtManifest, type VerifyResult } from "./manifest.js";

export * from "./abi.js";
export * from "./manifest.js";
export * from "./chains.js";
export * from "./cid.js";
export * from "./dns.js";
export * from "./a2a.js";

export interface ResolverOptions {
  /** Named chain from CHAINS (fills rpcUrl/registry/fns defaults). */
  chain?: string;
  rpcUrl?: string;
  /** Ordered JSON-RPC endpoints tried until one answers (transport failures only; a revert never fails over). Overrides `rpcUrl`. */
  rpcUrls?: readonly string[];
  registry?: string;
  /** Freename FNS address for the legacy ownership fallback. */
  fns?: string | null;
  /** Enable Registry v1 (FNS.ownerOf) fallback when a name is not in v2. Sunset: remove after the claim window. */
  legacyFns?: boolean;
  /** Enable DNS TXT (DoH) fallback for Manifest v1/v2 names not carrying an on-chain manifest. */
  legacyDns?: boolean;
  dohUrl?: string;
  /** Pin `ipfs://` manifest reads to one gateway (no fallback). */
  ipfsGateway?: string;
  /** Ordered gateways tried until one answers (default DEFAULT_IPFS_GATEWAYS, pinata first). Overrides `ipfsGateway`. */
  ipfsGateways?: readonly string[];
  timeoutMs?: number;
  /** Max manifest bytes accepted (default 256 KiB). */
  maxManifestBytes?: number;
}

export interface AgentRecords {
  addr: string | null;
  manifestUri: string;
  endpoints: Record<string, string>;   // protocol → url (queried for mcp, a2a, http, ws)
  wallet: string | null;
  texts: Record<string, string>;
}

export interface NameRecord {
  name: string;
  label: string;
  tokenId: string;
  node: string;
  registered: boolean;
  owner: string | null;
  expiry: string | null;       // unix seconds, or "perpetual"
  active: boolean;
  perpetual: boolean;
  resolver: string | null;     // AGTResolver address (launch) or null (MVP registry / inactive)
  records: AgentRecords;
  source: "registry-v2" | "fns-legacy" | "none";
}

/**
 * Transport vs trust (#338). `verified: false` alone cannot tell "the document failed the signature check" from "no
 * gateway returned the document", and a client that treats the second as a trust failure blames the owner for a 429.
 *   verified      loaded and passed every check
 *   unverified    loaded, but failed the signature / owner / name / CID check (or the name is expired) — do not act on it
 *   unavailable   a pointer exists but the document could not be fetched — retry later; says nothing about the owner
 *   none          nothing published (or the name is not registered)
 */
export type ManifestStatus = "verified" | "unverified" | "unavailable" | "none";

/** Pure: derive the status from what resolution learned. Exported for tests and for callers rebuilding a resolution. */
export function manifestStatusOf(r: { manifest: unknown | null; verified: boolean; fetchFailed: boolean }): ManifestStatus {
  if (r.fetchFailed) return "unavailable";
  if (!r.manifest) return "none";
  return r.verified ? "verified" : "unverified";
}

/** What `resolveAddresses` returns: the payable records of a name, nothing else. */
export interface AddressRecord {
  name: string;
  label: string;
  tokenId: string;
  node: string;
  registered: boolean;
  active: boolean;
  resolver: string | null;
  /** `addr(node)`: the name's primary EVM address (ENS semantics). null when unset or the name is inactive. */
  addr: string | null;
  /** `agentWallet(node)`: the wallet the agent sends and receives payments with. null when unset or inactive. */
  wallet: string | null;
  /** Present when a `coinType` was requested (decimal string). */
  coinType?: string;
  /** `addr(node, coinType)` as 0x-hex bytes (20 bytes for EVM coin types); null when unset. */
  coinTypeAddr?: string | null;
}

export interface AgentResolution extends NameRecord {
  manifest: AgtManifest | null;
  manifestSource: "onchain" | "dns" | "dns-inline-v1" | null;
  cid: CidCheck | null;
  verified: boolean;
  /** Which kind of `verified: false` this is — see ManifestStatus. */
  manifestStatus: ManifestStatus;
  reasons: string[];
  signer: string | null;
  legacy?: { fnsOwner: string | null };
}

const PERPETUAL = (1n << 64n) - 1n;
const REG = {
  ownerOf: selector("ownerOf(uint256)"),
  expiryOf: selector("expiryOf(uint256)"),
  isActive: selector("isActive(uint256)"),
  available: selector("available(uint256)"),
  resolverOf: selector("resolverOf(uint256)"),
  // MVP registry (records inline)
  manifestOf: selector("manifestOf(uint256)"),
  addrOf: selector("addrOf(uint256)"),
  text: selector("text(uint256,string)"),
};
const RES = {
  addr: selector("addr(bytes32)"),
  addrCoin: selector("addr(bytes32,uint256)"),
  text: selector("text(bytes32,string)"),
  agentManifest: selector("agentManifest(bytes32)"),
  agentEndpoint: selector("agentEndpoint(bytes32,string)"),
  agentWallet: selector("agentWallet(bytes32)"),
};
const ENDPOINT_PROTOCOLS = ["mcp", "a2a", "http", "ws"];
const ZERO40 = /^0x0{40}$/;
const nonZeroAddress = (hex: string | null): string | null => {
  if (!hex || hex.length < 66) return null;
  const a = decAddress(hex);
  return ZERO40.test(a) ? null : a;
};

type RpcItem = { id?: number; result?: string; error?: { message?: string } };

export class AgtResolver {
  readonly cfg: Required<Pick<ResolverOptions, "rpcUrl" | "registry">> & ResolverOptions & { rpcUrls: string[]; chainCfg: ChainConfig | null };

  constructor(opts: ResolverOptions) {
    const chainCfg = opts.chain ? chainByName(opts.chain) : null;
    // Precedence: explicit list > explicit single URL > the chain's list > the chain's single URL.
    const rpcUrls = opts.rpcUrls?.length ? [...opts.rpcUrls] : opts.rpcUrl ? [opts.rpcUrl] : chainCfg?.rpcUrls?.length ? [...chainCfg.rpcUrls] : chainCfg?.rpcUrl ? [chainCfg.rpcUrl] : [];
    const rpcUrl = rpcUrls[0];
    const registry = opts.registry ?? chainCfg?.registry ?? undefined;
    if (!rpcUrl) throw new Error("rpcUrl (or a known chain) is required");
    if (!registry) throw new Error(chainCfg ? `AGT Registry v2 is not deployed on ${chainCfg.name} yet — pass { registry }` : "registry is required");
    this.cfg = { ...opts, rpcUrl, rpcUrls, registry, chainCfg, fns: opts.fns ?? chainCfg?.fns ?? null };
  }

  // ------------------------------------------------------------------ rpc

  /** POST one JSON-RPC body (single or batch) to the first endpoint that answers. Transport failures (network, timeout,
   *  non-2xx, non-JSON) move to the next endpoint; a JSON-RPC error is an answer and is returned to the caller. */
  private async post(body: unknown): Promise<unknown> {
    let last: unknown;
    for (const url of this.cfg.rpcUrls) {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), this.cfg.timeoutMs ?? 15_000);
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: c.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        last = e;
      } finally { clearTimeout(t); }
    }
    throw new Error(`rpc failed on ${this.cfg.rpcUrls.length} endpoint(s): ${(last as Error)?.message ?? String(last)}`);
  }

  private async rpc(method: string, params: unknown[]): Promise<string> {
    const j = (await this.post({ jsonrpc: "2.0", id: 1, method, params })) as RpcItem;
    if (j.error) throw new Error(j.error.message ?? "rpc error");
    return j.result ?? "0x";
  }
  private call(to: string, data: string) { return this.rpc("eth_call", [{ to, data }, "latest"]); }
  private async tryCall(to: string, data: string): Promise<string | null> { try { return await this.call(to, data); } catch { return null; } }

  /** Several eth_calls in one round trip. A reverting item yields null (like tryCall). Endpoints that answer a batch
   *  with a single object fall back to one call per item. */
  private async batchCall(calls: Array<{ to: string; data: string }>): Promise<Array<string | null>> {
    if (calls.length === 0) return [];
    const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, method: "eth_call", params: [{ to: c.to, data: c.data }, "latest"] }));
    const j = await this.post(body);
    if (!Array.isArray(j)) return Promise.all(calls.map((c) => this.tryCall(c.to, c.data)));
    const byId = new Map<number, RpcItem>();
    for (const item of j as RpcItem[]) if (item && typeof item.id === "number") byId.set(item.id, item);
    return calls.map((_, i) => { const it = byId.get(i + 1); return it && !it.error && typeof it.result === "string" ? it.result : null; });
  }

  // -------------------------------------------------------------- registry

  /** On-chain state + records (no manifest fetch). */
  async resolve(input: string): Promise<NameRecord> {
    const name = normalizeName(input);
    const label = labelOf(name);
    const id = tokenIdOf(name);
    const idHex = encUint(id);
    const node = namehash(name);
    const reg = this.cfg.registry;

    const ownerHex = await this.tryCall(reg, REG.ownerOf + idHex);
    const [expiryHex, activeHex, resolverHex] = await Promise.all([
      this.call(reg, REG.expiryOf + idHex),
      this.call(reg, REG.isActive + idHex),
      this.tryCall(reg, REG.resolverOf + idHex), // MVP registry has no resolverOf → null
    ]);
    const expiry = decUint(expiryHex);
    const active = decBool(activeHex);
    const resolverAddr = resolverHex && resolverHex.length >= 66 ? decAddress(resolverHex) : null;
    const resolver = resolverAddr && !ZERO40.test(resolverAddr) ? resolverAddr : null;

    const records: AgentRecords = { addr: null, manifestUri: "", endpoints: {}, wallet: null, texts: {} };
    if (active) {
      if (resolver) {
        const nodeHex = pad32(node);
        const [addrHex, manHex, walletHex, ...eps] = await Promise.all([
          this.tryCall(resolver, RES.addr + nodeHex),
          this.tryCall(resolver, RES.agentManifest + nodeHex),
          this.tryCall(resolver, RES.agentWallet + nodeHex),
          ...ENDPOINT_PROTOCOLS.map((p) => { const { head, tail } = encString(p, 1, 2); return this.tryCall(resolver, RES.agentEndpoint + nodeHex + head + tail); }),
        ]);
        const a = addrHex ? decAddress(addrHex) : null;
        records.addr = a && !ZERO40.test(a) ? a : null;
        records.manifestUri = manHex ? decString(manHex) : "";
        const w = walletHex ? decAddress(walletHex) : null;
        records.wallet = w && !ZERO40.test(w) ? w : null;
        eps.forEach((h, i) => { const v = h ? decString(h) : ""; if (v) records.endpoints[ENDPOINT_PROTOCOLS[i]] = v; });
      } else if (resolverHex === null) {
        // MVP registry: records live on the registry itself
        const [manHex, addrHex, ...eps] = await Promise.all([
          this.tryCall(reg, REG.manifestOf + idHex),
          this.tryCall(reg, REG.addrOf + idHex),
          ...ENDPOINT_PROTOCOLS.map((p) => { const { head, tail } = encString(`agent-endpoint[${p}]`, 1, 2); return this.tryCall(reg, REG.text + idHex + head + tail); }),
        ]);
        records.manifestUri = manHex ? decString(manHex) : "";
        const a = addrHex ? decAddress(addrHex) : null;
        records.addr = a && !ZERO40.test(a) ? a : null;
        eps.forEach((h, i) => { const v = h ? decString(h) : ""; if (v) records.endpoints[ENDPOINT_PROTOCOLS[i]] = v; });
      }
    }

    return {
      name, label, tokenId: id.toString(), node,
      registered: expiry !== 0n,
      owner: ownerHex && ownerHex.length >= 66 ? decAddress(ownerHex) : null,
      expiry: expiry === 0n ? null : expiry === PERPETUAL ? "perpetual" : expiry.toString(),
      active, perpetual: expiry === PERPETUAL, resolver, records,
      source: expiry !== 0n ? "registry-v2" : "none",
    };
  }

  /**
   * Address fast path for wallets (the MetaMask Snap's send flow): two JSON-RPC round trips — registry state, then the
   * resolver's `addr` / `agentWallet` (and `addr(node, coinType)` when asked) — and no manifest fetch. An inactive
   * name returns null addresses: the resolver's live gate answers zero for lapsed names and zero maps to null here.
   */
  async resolveAddresses(input: string, opts: { coinType?: bigint | number } = {}): Promise<AddressRecord> {
    const name = normalizeName(input);
    const label = labelOf(name);
    const id = tokenIdOf(name);
    const idHex = encUint(id);
    const node = namehash(name);
    const reg = this.cfg.registry;
    const coinType = opts.coinType === undefined ? null : BigInt(opts.coinType);

    const [expiryHex, activeHex, resolverHex] = await this.batchCall([
      { to: reg, data: REG.expiryOf + idHex },
      { to: reg, data: REG.isActive + idHex },
      { to: reg, data: REG.resolverOf + idHex }, // MVP registry has no resolverOf → null
    ]);
    // A registry that does not answer expiryOf/isActive is a failure, not an unregistered name: a wallet must be able
    // to tell "no such name" from "could not read", or an RPC hiccup silently drops the payee.
    if (expiryHex === null || activeHex === null) throw new Error(`registry ${reg} did not answer for ${name} (eth_call error)`);
    const expiry = decUint(expiryHex);
    const active = decBool(activeHex);
    const resolver = nonZeroAddress(resolverHex);

    const out: AddressRecord = { name, label, tokenId: id.toString(), node, registered: expiry !== 0n, active, resolver, addr: null, wallet: null };
    if (coinType !== null) { out.coinType = coinType.toString(); out.coinTypeAddr = null; }
    if (!active) return out;

    if (resolver) {
      const nodeHex = pad32(node);
      const calls = [{ to: resolver, data: RES.addr + nodeHex }, { to: resolver, data: RES.agentWallet + nodeHex }];
      if (coinType !== null) calls.push({ to: resolver, data: RES.addrCoin + nodeHex + encUint(coinType) });
      const [addrHex, walletHex, coinHex] = await this.batchCall(calls);
      out.addr = nonZeroAddress(addrHex);
      out.wallet = nonZeroAddress(walletHex);
      if (coinType !== null) {
        const b = coinHex ? decBytes(coinHex) : "";
        out.coinTypeAddr = b && !/^0x0*$/.test(b) ? b : null;
      }
    } else if (resolverHex === null) {
      // MVP registry: the address record lives on the registry itself
      const [addrHex] = await this.batchCall([{ to: reg, data: REG.addrOf + idHex }]);
      out.addr = nonZeroAddress(addrHex);
    }
    return out;
  }

  /** Read a text record (launch resolver `text(node,key)`; MVP registry `text(id,key)`). */
  async text(input: string, key: string): Promise<string> {
    const rec = await this.resolve(input);
    if (!rec.active) return "";
    const { head, tail } = encString(key, 1, 2);
    if (rec.resolver) return decString((await this.tryCall(rec.resolver, RES.text + pad32(rec.node) + head + tail)) ?? "0x");
    return decString((await this.tryCall(this.cfg.registry, REG.text + encUint(BigInt(rec.tokenId)) + head + tail)) ?? "0x");
  }

  async available(input: string): Promise<boolean> {
    return decBool(await this.call(this.cfg.registry, REG.available + encUint(tokenIdOf(normalizeName(input)))));
  }

  /** Registry v1 fallback: current FNS owner of `label.agt` (Freename id scheme). */
  async fnsOwner(input: string): Promise<string | null> {
    if (!this.cfg.fns) return null;
    const label = labelOf(normalizeName(input));
    const fnsId = keccakHex(concatBytes(new TextEncoder().encode("agt"), hexToBytesLocal(keccakHex(label))));
    const res = await this.tryCall(this.cfg.fns, REG.ownerOf + pad32(fnsId));
    return res && res.length >= 66 ? decAddress(res) : null;
  }

  // ------------------------------------------------------------- manifest

  /** Full resolution: registry record + manifest fetch + CID check + three-way verification (+ legacy fallbacks). */
  async resolveAgent(input: string): Promise<AgentResolution> {
    const rec = await this.resolve(input);
    const out: AgentResolution = { ...rec, manifest: null, manifestSource: null, cid: null, verified: false, manifestStatus: "none", reasons: [], signer: null };

    let uri = rec.records.manifestUri;
    let dnsInline: Record<string, string[]> | null = null;
    if (!rec.registered) out.reasons.push("name not registered in Registry v2");
    else if (!rec.active) out.reasons.push("name expired (in grace or lapsed)");

    // legacy fallbacks
    if ((!rec.registered || !uri) && this.cfg.legacyDns) {
      try {
        const d = await dnsTxt(rec.name, { dohUrl: this.cfg.dohUrl, timeoutMs: this.cfg.timeoutMs });
        if (d.manifestUri) { uri = d.manifestUri; out.manifestSource = "dns"; }
        else if (d.inlineV1) dnsInline = d.inlineV1;
      } catch (e) { out.reasons.push(`dns fallback failed: ${(e as Error).message}`); }
    }
    if (!rec.registered && this.cfg.legacyFns) {
      const fnsOwner = await this.fnsOwner(rec.name);
      out.legacy = { fnsOwner };
      if (fnsOwner) { out.source = "fns-legacy"; out.reasons.push("owned on Registry v1 (Freename) — not yet migrated to v2"); }
    }

    if (dnsInline) {
      out.manifest = inlineV1ToManifest(rec.name, dnsInline) as unknown as AgtManifest;
      out.manifestSource = "dns-inline-v1";
      out.reasons.push("Manifest v1 inline TXT: unsigned legacy format (lower trust)");
      out.manifestStatus = "unverified";
      return out;
    }
    if (!uri) { if (rec.active) out.reasons.push("no manifest set"); return out; }
    if (!out.manifestSource) out.manifestSource = "onchain";

    let fetchFailed = false;
    try {
      const bytes = await fetchManifestBytes(uri, { ipfsGateway: this.cfg.ipfsGateway, ipfsGateways: this.cfg.ipfsGateways, timeoutMs: this.cfg.timeoutMs, maxBytes: this.cfg.maxManifestBytes });
      out.cid = verifyCid(cidFromUri(uri), bytes);
      if (out.cid === "mismatch") out.reasons.push("IPFS content does not match its CID");
      const manifest = parseManifest(bytes);
      out.manifest = manifest;
      if (manifest.name && normalizeName(manifest.name) !== rec.name) out.reasons.push(`manifest.name ${manifest.name} != ${rec.name}`);
      const v: VerifyResult = verifyManifest(manifest, rec.active ? rec.owner : out.legacy?.fnsOwner ?? null);
      out.signer = v.signer;
      out.reasons.push(...v.reasons);
    } catch (e) {
      // fetch, size cap or JSON parse: the document never became a manifest, so this is transport, not trust
      fetchFailed = out.manifest === null;
      out.reasons.push(`manifest fetch failed: ${(e as Error).message}`);
    }
    out.verified = out.reasons.length === 0;
    out.manifestStatus = manifestStatusOf({ manifest: out.manifest, verified: out.verified, fetchFailed });
    return out;
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; }
function hexToBytesLocal(hex: string): Uint8Array { const h = hex.replace(/^0x/, ""); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return o; }

/** Convenience one-shots. */
export const resolveAgent = (name: string, opts: ResolverOptions) => new AgtResolver(opts).resolveAgent(name);
export const isAgent = async (name: string, opts: ResolverOptions) => (await new AgtResolver(opts).resolveAgent(name)).verified;
export { CHAINS };
