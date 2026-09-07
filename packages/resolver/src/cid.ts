/**
 * Minimal CID handling: verify that fetched bytes match an `ipfs://` CID.
 * Supports CIDv1 + raw codec (0x55) + sha2-256 (the shape our pinning path produces: "bafkrei…").
 * Anything else returns "unsupported" rather than a false negative.
 */
import { sha256 } from "@noble/hashes/sha256";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.toLowerCase()) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error("invalid base32");
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

/** CIDv1(raw, sha2-256) for `bytes`, base32 multibase ("b" prefix). */
export function rawCidV1(bytes: Uint8Array): string {
  const digest = sha256(bytes);
  const prefix = new Uint8Array([0x01, 0x55, 0x12, 0x20]); // version 1, raw codec, sha2-256, 32 bytes
  const cid = new Uint8Array(prefix.length + digest.length);
  cid.set(prefix, 0); cid.set(digest, prefix.length);
  return "b" + base32Encode(cid);
}

export function cidFromUri(uri: string): string | null {
  if (!uri.startsWith("ipfs://")) return null;
  return uri.slice(7).replace(/^ipfs\//, "").split(/[/?#]/)[0] || null;
}

export type CidCheck = "match" | "mismatch" | "unsupported" | "not-ipfs";

/** Compare `bytes` against `cid`. Only raw-codec CIDv1 is verifiable here. */
export function verifyCid(cid: string | null, bytes: Uint8Array): CidCheck {
  if (!cid) return "not-ipfs";
  if (!cid.startsWith("b")) return "unsupported"; // base58 CIDv0 or other multibase
  let decoded: Uint8Array;
  try { decoded = base32Decode(cid.slice(1)); } catch { return "unsupported"; }
  // version 1, raw codec, sha2-256 multihash
  if (decoded.length !== 36 || decoded[0] !== 0x01 || decoded[1] !== 0x55 || decoded[2] !== 0x12 || decoded[3] !== 0x20) return "unsupported";
  return rawCidV1(bytes) === cid ? "match" : "mismatch";
}
