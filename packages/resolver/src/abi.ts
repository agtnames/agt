/**
 * Minimal ABI helpers — enough to call AGTRegistry read functions over raw JSON-RPC.
 * Intentionally dependency-light (keccak from @noble/hashes only).
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export const keccakHex = (data: Uint8Array | string): string =>
  "0x" + bytesToHex(keccak_256(typeof data === "string" ? utf8ToBytes(data) : data));

export const selector = (signature: string): string => keccakHex(signature).slice(0, 10);

const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
export const pad32 = (hex: string): string => strip(hex).padStart(64, "0");
export const encUint = (n: bigint): string => pad32(n.toString(16));
export const encAddress = (a: string): string => pad32(a.toLowerCase());

/** ABI-encode a dynamic `string` argument that is the ONLY dynamic arg at position `dynIndex` of `total` args. */
export function encString(s: string, dynIndex: number, total: number): { head: string; tail: string } {
  const bytes = utf8ToBytes(s);
  const offset = BigInt(32 * total); // tail starts right after the head slots
  const len = encUint(BigInt(bytes.length));
  const data = bytesToHex(bytes).padEnd(Math.ceil(bytes.length / 32) * 64, "0");
  void dynIndex;
  return { head: encUint(offset), tail: len + data };
}

export const decUint = (hex: string): bigint => BigInt("0x" + (strip(hex) || "0"));
export const decBool = (hex: string): boolean => decUint(hex) !== 0n;
export const decAddress = (hex: string): string => "0x" + strip(hex).slice(-40);
export function decString(hex: string): string {
  const h = strip(hex);
  if (h.length < 128) return "";
  const off = Number(BigInt("0x" + h.slice(0, 64))) * 2;
  const len = Number(BigInt("0x" + h.slice(off, off + 64))) * 2;
  return new TextDecoder().decode(hexToBytes(h.slice(off + 64, off + 64 + len)));
}

/** ENS namehash. `namehash("exampleagent.agt")` == AGTRegistry.nodeOf("exampleagent"). */
export function namehash(name: string): string {
  let node: Uint8Array = new Uint8Array(32);
  if (name) {
    const labels = name.toLowerCase().replace(/\.$/, "").split(".");
    for (let i = labels.length - 1; i >= 0; i--) {
      const labelHash = keccak_256(utf8ToBytes(labels[i]));
      const buf = new Uint8Array(64);
      buf.set(node, 0);
      buf.set(labelHash, 32);
      node = keccak_256(buf);
    }
  }
  return "0x" + bytesToHex(node);
}

export const tokenIdOf = (name: string): bigint => BigInt(namehash(normalizeName(name)));

/** Accepts "label", "label.agt" or "label.agt." → "label.agt" */
export function normalizeName(input: string): string {
  const n = input.trim().toLowerCase().replace(/\.$/, "");
  return n.endsWith(".agt") ? n : `${n}.agt`;
}
export const labelOf = (name: string): string => normalizeName(name).slice(0, -4);
