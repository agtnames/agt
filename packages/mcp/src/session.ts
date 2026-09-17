/**
 * Local session store for the countersign write tools (D-025 v2).
 *
 * The session key never leaves this machine. It is generated here, stored encrypted (scrypt + AES-256-GCM) under
 * AGT_SESSION_DIR, and used only to redeem a grant the owner signed. The grant itself is not secret and is stored
 * alongside as plain JSON. Caveats on-chain, not this encryption, bound what a compromised running agent can do.
 */
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeGrant, describeGrant, type GrantV1 } from "@agtnames/countersign";

export interface SessionConfig {
  dir: string;
  passphrase: string;
}

export function sessionConfig(env: NodeJS.ProcessEnv = process.env): SessionConfig | null {
  const passphrase = env.AGT_SESSION_PASSPHRASE?.trim();
  if (!passphrase) return null;
  if (passphrase.length < 12) throw new Error("AGT_SESSION_PASSPHRASE must be at least 12 characters");
  const dir = env.AGT_SESSION_DIR?.trim() || path.join(homedir(), ".agt", "session");
  return { dir, passphrase };
}

interface Envelope { v: 1; address: `0x${string}`; kdf: { N: number; r: number; p: number; salt: string }; iv: string; ct: string; tag: string; createdAt: string }

const KDF = { N: 2 ** 15, r: 8, p: 1 } as const;
const keyFile = (c: SessionConfig) => path.join(c.dir, "session.json");
const grantFile = (c: SessionConfig) => path.join(c.dir, "grant.json");

function encrypt(pk: `0x${string}`, c: SessionConfig): Envelope {
  const salt = randomBytes(16);
  const key = scryptSync(c.passphrase.normalize("NFKC"), salt, 32, { ...KDF, maxmem: 128 * 1024 * 1024 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(pk.slice(2), "hex")), cipher.final()]);
  return { v: 1, address: privateKeyToAccount(pk).address, kdf: { ...KDF, salt: salt.toString("base64") }, iv: iv.toString("base64"), ct: ct.toString("base64"), tag: cipher.getAuthTag().toString("base64"), createdAt: new Date().toISOString() };
}

function decrypt(e: Envelope, c: SessionConfig): `0x${string}` {
  const key = scryptSync(c.passphrase.normalize("NFKC"), Buffer.from(e.kdf.salt, "base64"), 32, { N: e.kdf.N, r: e.kdf.r, p: e.kdf.p, maxmem: 128 * 1024 * 1024 });
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"));
  d.setAuthTag(Buffer.from(e.tag, "base64"));
  const pk = Buffer.concat([d.update(Buffer.from(e.ct, "base64")), d.final()]);
  return ("0x" + pk.toString("hex")) as `0x${string}`;
}

export class SessionStore {
  constructor(private readonly c: SessionConfig) {}

  /** Session address if a key exists, else null. Does not need the passphrase to be right. */
  address(): `0x${string}` | null {
    if (!existsSync(keyFile(this.c))) return null;
    return (JSON.parse(readFileSync(keyFile(this.c), "utf8")) as Envelope).address;
  }

  /** Create the session key if none exists. Returns the address (never the key). */
  ensureKey(): { address: `0x${string}`; created: boolean } {
    const existing = this.address();
    if (existing) return { address: existing, created: false };
    mkdirSync(this.c.dir, { recursive: true });
    const pk = generatePrivateKey();
    writeFileSync(keyFile(this.c), JSON.stringify(encrypt(pk, this.c), null, 2), { mode: 0o600 });
    return { address: privateKeyToAccount(pk).address, created: true };
  }

  /** Decrypt the session key for one redemption. Throws on a wrong passphrase. */
  privateKey(): `0x${string}` {
    if (!existsSync(keyFile(this.c))) throw new Error("no session key; call agt_session_new first");
    try { return decrypt(JSON.parse(readFileSync(keyFile(this.c), "utf8")) as Envelope, this.c); }
    catch { throw new Error("AGT_SESSION_PASSPHRASE does not unlock the stored session key"); }
  }

  /** Validate a grant blob against this session and store it. */
  async importGrant(blob: string, now = Math.floor(Date.now() / 1000)) {
    const grant = decodeGrant(blob);
    const address = this.address();
    if (!address) throw new Error("no session key; call agt_session_new first, then have the owner sign a grant for that address");
    if (grant.delegate.toLowerCase() !== address.toLowerCase()) throw new Error(`grant delegate ${grant.delegate} is not this session (${address}); the owner must sign a grant for this session's address`);
    const d = await describeGrant(grant, { now });
    if (!d.ok) throw new Error(`grant refused: ${d.problems.join("; ")}`);
    mkdirSync(this.c.dir, { recursive: true });
    writeFileSync(grantFile(this.c), JSON.stringify(grant), { mode: 0o600 });
    return { grant, description: d };
  }

  grant(): GrantV1 | null {
    if (!existsSync(grantFile(this.c))) return null;
    return decodeGrant(readFileSync(grantFile(this.c), "utf8"));
  }

  /** Forget the grant (and optionally the key). Local only: on-chain revocation is the owner's nonce bump. */
  forget(opts: { key?: boolean } = {}) {
    if (existsSync(grantFile(this.c))) rmSync(grantFile(this.c));
    if (opts.key && existsSync(keyFile(this.c))) rmSync(keyFile(this.c));
  }
}
