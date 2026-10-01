/**
 * Manifest v3: build from the owner's input file, sign (EIP-191 over the canonical form), host, point the name at it.
 * The build mirrors the site's scripts/publish-manifest.mjs and src/lib/manifest-v3.ts, so a document published from
 * here and one published from the browser editor canonicalize identically.
 */
import { canonicalize, verifyManifest, type AgtManifest } from "@agtnames/resolver";
import type { Address } from "viem";
import type { Signer } from "./signer.js";

/** What the owner writes; name / owner / updated / agt are filled in. */
export interface ManifestInput {
  description?: string;
  website?: string;
  icon?: string;
  endpoints?: { protocol: string; url: string; version?: string }[];
  capabilities?: (string | { id: string; description?: string })[];
  pricing?: { model?: string; [k: string]: unknown };
  payments?: { rail: string; chain?: string; address?: string; token?: string }[];
  keys?: AgtManifest["keys"];
  registrations?: AgtManifest["registrations"];
}

export const MANIFEST_TEMPLATE: ManifestInput = {
  description: "What this agent does, in one sentence.",
  website: "https://example.com",
  endpoints: [
    { protocol: "mcp", url: "https://example.com/mcp" },
    { protocol: "http", url: "https://example.com/api" },
  ],
  capabilities: ["example-capability"],
  pricing: { model: "free" },
  payments: [],
};

export function stripEmpty<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripEmpty).filter((x) => x !== undefined && x !== "") as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const y = stripEmpty(x);
      if (y === undefined || y === "" || (Array.isArray(y) && y.length === 0)) continue;
      out[k] = y;
    }
    return out as T;
  }
  return v;
}

export function buildManifest(label: string, owner: Address, input: ManifestInput, now = new Date()): AgtManifest {
  return stripEmpty({
    agt: "3.0",
    name: `${label}.agt`,
    owner,
    updated: now.toISOString(),
    description: input.description,
    icon: input.icon,
    website: input.website,
    keys: input.keys,
    endpoints: (input.endpoints ?? []).filter((e) => e && e.url),
    capabilities: (input.capabilities ?? []).map((c) => (typeof c === "string" ? { id: c.trim().toLowerCase() } : c)),
    pricing: input.pricing && input.pricing.model ? input.pricing : undefined,
    payments: (input.payments ?? []).filter((p) => p && p.address),
    registrations: input.registrations ?? [],
  }) as AgtManifest;
}

/** Problems to fix before signing, in plain words. Empty = fine. */
export function lintInput(input: ManifestInput): string[] {
  const out: string[] = [];
  if (input.description === MANIFEST_TEMPLATE.description) out.push("description is still the template text");
  for (const e of input.endpoints ?? []) {
    if (!e.protocol) out.push("an endpoint has no protocol");
    if (!/^https:\/\//.test(e.url ?? "")) out.push(`endpoint ${e.protocol ?? "?"} must be an https:// URL (got ${e.url || "nothing"})`);
    if (/\bexample\.com\b/.test(e.url ?? "")) out.push(`endpoint ${e.protocol} is still the template URL`);
  }
  for (const p of input.payments ?? []) if (p.address && !/^0x[0-9a-fA-F]{40}$/.test(p.address)) out.push(`payment address ${p.address} is not a 0x address`);
  return out;
}

export async function signManifestWith(signer: Signer, unsigned: AgtManifest): Promise<AgtManifest> {
  const signature = await signer.signMessage(canonicalize(unsigned), `Sign the manifest for ${unsigned.name}`);
  const signed = { ...unsigned, signature };
  const v = verifyManifest(signed, signer.address);
  if (!v.verified) throw new Error(`the signed manifest does not verify: ${v.reasons.join("; ")}`);
  return signed;
}

export interface PinResult { uri: string; provider: string; digest?: string; cid?: string }

/** POST to the site's pin API, which re-verifies signer == owner == on-chain owner before storing. */
export async function hostManifest(site: string, manifest: AgtManifest, host: "agts.dev" | "ipfs", fetchImpl: typeof fetch = fetch): Promise<PinResult> {
  const r = await fetchImpl(`${site}/api/v2/manifest/pin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest, host }) });
  const body = (await r.json().catch(() => ({}))) as { error?: string; reasons?: string[] } & Partial<PinResult>;
  if (!r.ok || !body.uri) throw new Error(`hosting failed (${r.status}): ${body.error ?? "no uri returned"}${body.reasons?.length ? " — " + body.reasons.join("; ") : ""}`);
  return body as PinResult;
}
