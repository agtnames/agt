/**
 * Manifest v3 (draft) — canonicalization, signing helpers and verification.
 * See spec/agt-manifest-v3-draft.md. Canonicalization MUST match contracts/scripts/testbed.cjs.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

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
  pricing?: unknown;
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

/** Fetch a manifest URI: ipfs:// (via gateway), https://, or data: (base64 or utf8). */
export async function fetchManifest(uri: string, opts: { ipfsGateway?: string; timeoutMs?: number } = {}): Promise<AgtManifest> {
  const gateway = (opts.ipfsGateway ?? "https://dweb.link/ipfs/").replace(/\/?$/, "/");
  if (uri.startsWith("data:")) {
    const comma = uri.indexOf(",");
    const meta = uri.slice(5, comma);
    const payload = uri.slice(comma + 1);
    const text = /;base64/i.test(meta) ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload);
    return JSON.parse(text);
  }
  const url = uri.startsWith("ipfs://") ? gateway + uri.slice(7).replace(/^ipfs\//, "") : uri;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), opts.timeoutMs ?? 10_000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`fetch ${url} → HTTP ${r.status}`);
    return (await r.json()) as AgtManifest;
  } finally {
    clearTimeout(t);
  }
}
