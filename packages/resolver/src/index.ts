/**
 * @agt/resolver — resolve .agt names against AGT Registry v2 and verify their manifests.
 *
 *   import { AgtResolver } from "@agt/resolver";
 *   const agt = new AgtResolver({ rpcUrl, registry });
 *   const r = await agt.resolveAgent("exampleagent.agt");
 *   // r.owner, r.active, r.perpetual, r.manifest, r.verified, r.reasons
 */
import {
  decAddress, decBool, decString, decUint, encString, encUint, labelOf, namehash, normalizeName, selector, tokenIdOf,
} from "./abi.js";
import { fetchManifest, verifyManifest, type AgtManifest, type VerifyResult } from "./manifest.js";

export * from "./abi.js";
export * from "./manifest.js";

export interface ResolverOptions {
  rpcUrl: string;
  registry: string;          // AGTRegistry address
  ipfsGateway?: string;
  timeoutMs?: number;
}

export interface NameRecord {
  name: string;
  label: string;
  tokenId: string;           // decimal string
  node: string;              // 0x… namehash
  registered: boolean;
  owner: string | null;
  expiry: string | null;     // unix seconds as string; "perpetual" when never expires
  active: boolean;
  perpetual: boolean;
  manifestUri: string;
  addr: string | null;
}

export interface AgentResolution extends NameRecord {
  manifest: AgtManifest | null;
  verified: boolean;
  reasons: string[];
  signer: string | null;
}

const PERPETUAL = (1n << 64n) - 1n;
const SEL = {
  ownerOf: selector("ownerOf(uint256)"),
  expiryOf: selector("expiryOf(uint256)"),
  isActive: selector("isActive(uint256)"),
  manifestOf: selector("manifestOf(uint256)"),
  addrOf: selector("addrOf(uint256)"),
  text: selector("text(uint256,string)"),
  available: selector("available(uint256)"),
  nameOf: selector("nameOf(uint256)"),
};

export class AgtResolver {
  constructor(private readonly opts: ResolverOptions) {
    if (!opts.rpcUrl || !opts.registry) throw new Error("rpcUrl and registry are required");
  }

  private async rpc(method: string, params: unknown[]): Promise<string> {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), this.opts.timeoutMs ?? 15_000);
    try {
      const r = await fetch(this.opts.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: c.signal,
      });
      const j = (await r.json()) as { result?: string; error?: { message: string } };
      if (j.error) throw new Error(j.error.message);
      return j.result ?? "0x";
    } finally {
      clearTimeout(t);
    }
  }

  private call(data: string): Promise<string> {
    return this.rpc("eth_call", [{ to: this.opts.registry, data }, "latest"]);
  }

  /** Read on-chain state for a name (no manifest fetch). */
  async resolve(input: string): Promise<NameRecord> {
    const name = normalizeName(input);
    const label = labelOf(name);
    const id = tokenIdOf(name);
    const idHex = encUint(id);

    let owner: string | null = null;
    try { owner = decAddress(await this.call(SEL.ownerOf + idHex)); } catch { owner = null; } // reverts when unregistered/burned
    const [expiryHex, activeHex, manifestHex, addrHex] = await Promise.all([
      this.call(SEL.expiryOf + idHex),
      this.call(SEL.isActive + idHex),
      this.call(SEL.manifestOf + idHex),
      this.call(SEL.addrOf + idHex),
    ]);
    const expiry = decUint(expiryHex);
    const addr = decAddress(addrHex);
    return {
      name, label, tokenId: id.toString(), node: namehash(name),
      registered: expiry !== 0n,
      owner,
      expiry: expiry === 0n ? null : expiry === PERPETUAL ? "perpetual" : expiry.toString(),
      active: decBool(activeHex),
      perpetual: expiry === PERPETUAL,
      manifestUri: decString(manifestHex),
      addr: /^0x0{40}$/.test(addr) ? null : addr,
    };
  }

  /** Read a text record, e.g. "agent-endpoint[mcp]". */
  async text(input: string, key: string): Promise<string> {
    const id = tokenIdOf(normalizeName(input));
    const { head, tail } = encString(key, 1, 2);
    return decString(await this.call(SEL.text + encUint(id) + head + tail));
  }

  async available(input: string): Promise<boolean> {
    return decBool(await this.call(SEL.available + encUint(tokenIdOf(normalizeName(input)))));
  }

  /** Full resolution: on-chain record + manifest fetch + three-way verification. */
  async resolveAgent(input: string): Promise<AgentResolution> {
    const rec = await this.resolve(input);
    let manifest: AgtManifest | null = null;
    let v: VerifyResult = { verified: false, signer: null, reasons: [] };
    if (!rec.registered) v.reasons.push("name not registered");
    else if (!rec.active) v.reasons.push("name expired (in grace or lapsed)");
    else if (!rec.manifestUri) v.reasons.push("no manifest set");
    else {
      try {
        manifest = await fetchManifest(rec.manifestUri, { ipfsGateway: this.opts.ipfsGateway, timeoutMs: this.opts.timeoutMs });
        if (manifest.name && normalizeName(manifest.name) !== rec.name) v.reasons.push(`manifest.name ${manifest.name} != ${rec.name}`);
        const mv = verifyManifest(manifest, rec.owner);
        v = { ...mv, reasons: [...v.reasons, ...mv.reasons] };
        v.verified = v.reasons.length === 0;
      } catch (e) {
        v.reasons.push(`manifest fetch failed: ${(e as Error).message}`);
      }
    }
    return { ...rec, manifest, verified: v.verified, reasons: v.reasons, signer: v.signer };
  }
}

/** Convenience: one-shot resolution with options. */
export const resolveAgent = (name: string, opts: ResolverOptions) => new AgtResolver(opts).resolveAgent(name);
export const isAgent = async (name: string, opts: ResolverOptions) => (await new AgtResolver(opts).resolveAgent(name)).verified;
