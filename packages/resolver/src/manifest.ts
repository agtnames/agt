/**
 * Manifest v3 (draft) — canonicalization, signing helpers and verification.
 * See spec/agt-manifest-v3-draft.md. Canonicalization MUST match contracts/scripts/testbed.cjs.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

/** Manifest v3 §3.5. `model` is the field clients branch on; the rest is free-form and vendor-specific. */
export interface AgtPricing {
  model?: "free" | "freemium" | "paid" | "contact" | (string & {});
  free_tier?: string;
  paid?: { currency?: string; amount?: string; unit?: string; chain?: string; [k: string]: unknown };
  [k: string]: unknown;
}

export interface AgtManifest {
  agt: string;
  name: string;
  owner: string;
  updated?: string;
  description?: string;
  icon?: string;
  website?: string;
  keys?: { id: string; purpose: string; type: string; publicKey: string; revoked?: boolean }[];
  endpoints?: { protocol: string; url: string; version?: string }[];
  capabilities?: { id: string; description?: string; input?: unknown; output?: unknown }[];
  pricing?: AgtPricing;
  payments?: { rail: string; chain?: string; address?: string; token?: string }[];
  delegation?: { principal: string; scope: string[]; expires?: string };
  registrations?: { standard: string; chainId?: number; registry?: string; agentId?: string }[];
  signature?: string;
  [k: string]: unknown;
}

/** JCS-lite: keys sorted at every level, no whitespace. */
export function canonicalize(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export function canonicalUnsigned(m: AgtManifest): string {
  const { signature: _sig, ...rest } = m;
  void _sig;
  return canonicalize(rest);
}

/** EIP-191 personal_sign digest of a UTF-8 message. */
export function eip191Hash(message: string): Uint8Array {
  const msg = utf8ToBytes(message);
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`);
  const buf = new Uint8Array(prefix.length + msg.length);
  buf.set(prefix, 0);
  buf.set(msg, prefix.length);
  return keccak_256(buf);
}

export function pubkeyToAddress(uncompressed: Uint8Array): string {
  const body = uncompressed.length === 65 ? uncompressed.slice(1) : uncompressed;
  return "0x" + bytesToHex(keccak_256(body)).slice(-40);
}

/** Recover the signer address of an EIP-191 personal_sign signature (65-byte r‖s‖v, v ∈ {0,1,27,28}). */
export function recoverSigner(message: string, signatureHex: string): string {
  const sig = hexToBytes(signatureHex.startsWith("0x") ? signatureHex.slice(2) : signatureHex);
  if (sig.length !== 65) throw new Error("signature must be 65 bytes");
  let v = sig[64];
  if (v >= 27) v -= 27;
  const s = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v);
  const pub = s.recoverPublicKey(eip191Hash(message)).toRawBytes(false);
  return pubkeyToAddress(pub);
}

/** Sign a manifest with a raw secp256k1 private key (hex). Testbed/CLI use; production signs in the wallet. */
export function signManifest(unsigned: AgtManifest, privateKeyHex: string): AgtManifest {
  const { signature: _drop, ...rest } = unsigned;
  void _drop;
  const digest = eip191Hash(canonicalize(rest));
  const sig = secp256k1.sign(digest, hexToBytes(privateKeyHex.replace(/^0x/, "")));
  const rs = sig.toCompactRawBytes();
  const out = new Uint8Array(65);
  out.set(rs, 0);
  out[64] = 27 + (sig.recovery ?? 0);
  return { ...rest, signature: "0x" + bytesToHex(out) };
}

export interface VerifyResult {
  verified: boolean;
  signer: string | null;
  reasons: string[];
}

/**
 * Three-way check: signer == manifest.owner == on-chain owner (when provided).
 * Never throws for bad input — returns reasons.
 */
export function verifyManifest(m: AgtManifest, onchainOwner?: string | null): VerifyResult {
  const reasons: string[] = [];
  if (!m || typeof m !== "object") return { verified: false, signer: null, reasons: ["not an object"] };
  if (!/^3\./.test(String(m.agt))) reasons.push(`unsupported agt version ${m.agt}`);
  if (!m.signature) return { verified: false, signer: null, reasons: [...reasons, "unsigned"] };
  let signer: string | null = null;
  try {
    signer = recoverSigner(canonicalUnsigned(m), m.signature);
  } catch (e) {
    return { verified: false, signer: null, reasons: [...reasons, `bad signature: ${(e as Error).message}`] };
  }
  const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  if (!eq(signer, m.owner)) reasons.push(`signer ${signer} != manifest.owner ${m.owner}`);
  if (onchainOwner !== undefined) {
    if (!onchainOwner) reasons.push("name has no on-chain owner");
    else if (!eq(m.owner, onchainOwner)) reasons.push(`manifest.owner ${m.owner} != on-chain owner ${onchainOwner}`);
  }
  return { verified: reasons.length === 0, signer, reasons };
}

export const DEFAULT_MAX_MANIFEST_BYTES = 256 * 1024;

/**
 * Public gateways tried in order for `ipfs://` manifests when the caller pins none. Content is addressed by CID, so
 * any gateway returns the same bytes (and `verifyCid` checks them); a 429 or outage at one is never a verdict on the
 * document. Pinata first: on 2026-09-18 it served every registry manifest while dweb.link and ipfs.io rate-limited.
 */
export const DEFAULT_IPFS_GATEWAYS: readonly string[] = ["https://gateway.pinata.cloud/ipfs/", "https://dweb.link/ipfs/", "https://ipfs.io/ipfs/", "https://w3s.link/ipfs/"];

export interface FetchManifestOptions {
  /** Pin a single gateway (no fallback). Takes precedence over `ipfsGateways`' default but not over an explicit list. */
  ipfsGateway?: string;
  /** Ordered gateways to try for `ipfs://` URIs; default DEFAULT_IPFS_GATEWAYS (or `[ipfsGateway]` when that is set). */
  ipfsGateways?: readonly string[];
  /** Per-attempt timeout (each gateway gets its own). */
  timeoutMs?: number;
  maxBytes?: number;
}

/** The gateways a fetch will walk, normalised to a trailing slash. */
export function gatewaysFor(opts: Pick<FetchManifestOptions, "ipfsGateway" | "ipfsGateways">): string[] {
  const list = opts.ipfsGateways?.length ? opts.ipfsGateways : opts.ipfsGateway ? [opts.ipfsGateway] : DEFAULT_IPFS_GATEWAYS;
  return list.map((g) => g.replace(/\/?$/, "/"));
}

async function fetchBytes(url: string, timeoutMs: number, max: number): Promise<Uint8Array> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { accept: "application/json" }, redirect: "follow" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > max) throw new Error(`manifest exceeds ${max} bytes`);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > max) throw new Error(`manifest exceeds ${max} bytes`);
    return buf;
  } finally {
    clearTimeout(t);
  }
}

const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return url; } };
const base64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "")), (c) => c.charCodeAt(0));

/**
 * Fetch the raw bytes of a manifest URI: ipfs:// (via the gateway list, first success wins), https://, or data:
 * (base64 or utf8). Enforces a size cap. When every gateway fails the error names each one, e.g.
 * `fetch ipfs://bafy… failed: HTTP 429 (gateway.pinata.cloud); HTTP 429 (dweb.link)`.
 */
export async function fetchManifestBytes(uri: string, opts: FetchManifestOptions = {}): Promise<Uint8Array> {
  const max = opts.maxBytes ?? DEFAULT_MAX_MANIFEST_BYTES;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  if (uri.startsWith("data:")) {
    const comma = uri.indexOf(",");
    if (comma < 0) throw new Error("malformed data: URI");
    const meta = uri.slice(5, comma);
    const payload = uri.slice(comma + 1);
    // atob, not Buffer: the `.` export must run without Node globals (browsers, the MetaMask Snap sandbox).
    const bytes = /;base64/i.test(meta) ? base64ToBytes(payload) : new TextEncoder().encode(decodeURIComponent(payload));
    if (bytes.length > max) throw new Error(`manifest exceeds ${max} bytes`);
    return bytes;
  }
  if (uri.startsWith("https://")) {
    try { return await fetchBytes(uri, timeoutMs, max); }
    catch (e) { throw new Error(`fetch ${uri} → ${(e as Error).name === "AbortError" ? "timeout" : (e as Error).message}`); }
  }
  if (!uri.startsWith("ipfs://")) throw new Error(`unsupported manifest URI scheme: ${uri.split(":")[0]}`);
  const path = uri.slice(7).replace(/^ipfs\//, "");
  const failures: string[] = [];
  for (const gateway of gatewaysFor(opts)) {
    const url = gateway + path;
    try { return await fetchBytes(url, timeoutMs, max); }
    catch (e) { failures.push(`${(e as Error).name === "AbortError" ? "timeout" : (e as Error).message} (${hostOf(url)})`); }
  }
  throw new Error(`fetch ${uri} failed: ${failures.join("; ")}`);
}

export function parseManifest(bytes: Uint8Array): AgtManifest {
  const text = new TextDecoder().decode(bytes);
  const m = JSON.parse(text);
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("manifest is not a JSON object");
  return m as AgtManifest;
}

/** Fetch + parse a manifest URI (see fetchManifestBytes). */
export async function fetchManifest(uri: string, opts: FetchManifestOptions = {}): Promise<AgtManifest> {
  return parseManifest(await fetchManifestBytes(uri, opts));
}
