/**
 * Encrypted key files: the same envelope as @agtnames/mcp's session key (~/.agt/session/session.json), so one format
 * covers both. scrypt (N=2^15, r=8, p=1) → AES-256-GCM over the raw 32-byte key; the address is stored in the clear
 * so `agt keyfile address` and the ownership pre-check work without the passphrase.
 *
 *   { v: 1, address, kdf: { N, r, p, salt }, iv, ct, tag, createdAt }
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface KeyEnvelope { v: 1; address: Address; kdf: { N: number; r: number; p: number; salt: string }; iv: string; ct: string; tag: string; createdAt: string }

const KDF = { N: 2 ** 15, r: 8, p: 1 } as const;
const MAXMEM = 128 * 1024 * 1024;

export function checkPassphrase(p: string): string {
  if (p.length < 12) throw new Error("the keyfile passphrase must be at least 12 characters");
  return p.normalize("NFKC");
}

export function encryptKey(pk: Hex, passphrase: string): KeyEnvelope {
  const salt = randomBytes(16);
  const key = scryptSync(checkPassphrase(passphrase), salt, 32, { ...KDF, maxmem: MAXMEM });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(pk.slice(2), "hex")), cipher.final()]);
  key.fill(0);
  return { v: 1, address: privateKeyToAccount(pk).address, kdf: { ...KDF, salt: salt.toString("base64") }, iv: iv.toString("base64"), ct: ct.toString("base64"), tag: cipher.getAuthTag().toString("base64"), createdAt: new Date().toISOString() };
}

export function decryptKey(e: KeyEnvelope, passphrase: string): Hex {
  const key = scryptSync(checkPassphrase(passphrase), Buffer.from(e.kdf.salt, "base64"), 32, { N: e.kdf.N, r: e.kdf.r, p: e.kdf.p, maxmem: MAXMEM });
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"));
    d.setAuthTag(Buffer.from(e.tag, "base64"));
    const pk = Buffer.concat([d.update(Buffer.from(e.ct, "base64")), d.final()]);
    return ("0x" + pk.toString("hex")) as Hex;
  } catch {
    throw new Error("could not decrypt the keyfile: wrong passphrase, or the file was modified");
  } finally {
    key.fill(0);
  }
}

export function readKeyfile(path: string): KeyEnvelope {
  if (!existsSync(path)) throw new Error(`keyfile not found: ${path}`);
  let e: KeyEnvelope;
  try { e = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error(`${path} is not a keyfile (not JSON)`); }
  if (e?.v !== 1 || !e.address || !e.kdf?.salt || !e.iv || !e.ct || !e.tag) throw new Error(`${path} is not an agt keyfile (expected the v1 envelope that \`agt keyfile create\` writes)`);
  return e;
}

export function writeKeyfile(path: string, e: KeyEnvelope): void {
  if (existsSync(path)) throw new Error(`${path} already exists; remove it first if you mean to replace it`);
  writeFileSync(path, JSON.stringify(e, null, 2) + "\n", { mode: 0o600 });
}
