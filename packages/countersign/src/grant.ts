/**
 * Grant format v1 (D-025 v2): a bundle of per-name delegations, one signature per name, that lets a session
 * key perform chosen AGTResolver record writes on chosen names until an expiry, at most N times per name,
 * revocable in one transaction. Everything the summary says is something the chain enforces:
 *
 *   names[]     → AllowedTargets [resolver] + AllowedMethods [chosen setters] + AllowedCalldata (arg0 == node)
 *   notAfter    → Timestamp
 *   maxCalls    → LimitedCalls (per name)
 *   delegate    → Redeemer
 *   nonce       → Nonce (owner bumps NonceEnforcer to revoke every grant at once)
 *   value       → the function-call scope's implicit ValueLte(0): a grant can never move POL
 */
import {
  createDelegation, getSmartAccountsEnvironment, ScopeType, signDelegation as kitSignDelegation,
  type Delegation, type SmartAccountsEnvironment,
} from "@metamask/smart-accounts-kit";
import { CHAINS, namehash, normalizeName } from "@agtnames/resolver";
import { concatHex, getAddress, isAddress, isHex, keccak256, stringToHex, toHex, verifyTypedData, type Address, type Hex } from "viem";
import { ACTIONS, isActionId, type ActionId } from "./actions.js";

export const GRANT_VERSION = 1 as const;
export const SUPPORTED_CHAINS = [137, 80002] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number];

export interface GrantName {
  /** Normalised `label.agt`. */
  name: string;
  /** ENS-style namehash of `label.agt` == the registry tokenId (as bytes32). */
  node: Hex;
  /** The signed delegation for this name (signature is "0x" until the owner signs). */
  delegation: Delegation;
}

export interface GrantV1 {
  version: typeof GRANT_VERSION;
  chainId: SupportedChainId;
  /** The owner's address (EIP-7702-upgraded EOA). */
  delegator: Address;
  /** The session key that may redeem. */
  delegate: Address;
  delegationManager: Address;
  /** AGTResolver: the only allowed target. */
  resolver: Address;
  actions: ActionId[];
  /** Unix seconds. Redemptions after this revert (TimestampEnforcer). */
  notAfter: number;
  /** Max successful redemptions per name (LimitedCallsEnforcer). */
  maxCalls: number;
  /** NonceEnforcer nonce for (delegationManager, delegator) at signing time, bytes32. */
  nonce: Hex;
  names: GrantName[];
  /** keccak256 of the canonical unsigned grant; shown in every UI so a user can compare what they signed. */
  hash: Hex;
}

export interface BuildGrantInput {
  chainId: SupportedChainId;
  delegator: Address;
  delegate: Address;
  names: string[];
  actions: ActionId[];
  /** Seconds from `now` until expiry. */
  ttlSeconds: number;
  maxCalls: number;
  /** Current NonceEnforcer nonce (bigint from `currentNonce`, or bytes32 hex). */
  nonce: bigint | Hex;
  /** Override the resolver address (defaults to the @agtnames/resolver chain table). */
  resolver?: Address;
  now?: number;
}

export function environmentFor(chainId: number): SmartAccountsEnvironment {
  if (!SUPPORTED_CHAINS.includes(chainId as SupportedChainId)) throw new GrantError("unsupported_chain", `chain ${chainId} is not supported (137, 80002)`);
  return getSmartAccountsEnvironment(chainId);
}

export function defaultResolver(chainId: number): Address {
  const entry = Object.values(CHAINS).find((c) => c.chainId === chainId);
  if (!entry?.resolver) throw new GrantError("unsupported_chain", `no AGTResolver address known for chain ${chainId}`);
  return getAddress(entry.resolver);
}

export class GrantError extends Error {
  constructor(public readonly code:
    | "unsupported_chain" | "bad_input" | "bad_version" | "malformed" | "mismatch" | "expired" | "unsigned" | "bad_signature",
    message: string) { super(message); this.name = "GrantError"; }
}

const nonceHex = (n: bigint | Hex): Hex => (typeof n === "bigint" ? toHex(n, { size: 32 }) : (toHex(BigInt(n), { size: 32 }) as Hex));

/** Deterministic per-name salt so a grant can be rebuilt from its summary and compared byte-for-byte. */
export const saltFor = (nonce: Hex, node: Hex): Hex => keccak256(concatHex([nonce, node]));

function unsignedDelegation(env: SmartAccountsEnvironment, g: Omit<GrantV1, "names" | "hash">, node: Hex): Delegation {
  return createDelegation({
    environment: env,
    from: g.delegator,
    to: g.delegate,
    salt: saltFor(g.nonce, node),
    scope: {
      type: ScopeType.FunctionCall,
      targets: [g.resolver],
      selectors: g.actions.map((a) => ACTIONS[a].selector),
    },
    caveats: [
      { type: "allowedCalldata", startIndex: 4, value: node },
      { type: "timestamp", afterThreshold: 0, beforeThreshold: g.notAfter },
      { type: "limitedCalls", limit: g.maxCalls },
      { type: "redeemer", redeemers: [g.delegate] },
      { type: "nonce", nonce: g.nonce },
    ],
  }) as Delegation;
}

/** Build an unsigned grant. Each `names[i].delegation.signature` is "0x" until signed. */
export function buildGrant(input: BuildGrantInput): GrantV1 {
  const env = environmentFor(input.chainId);
  if (!isAddress(input.delegator) || !isAddress(input.delegate)) throw new GrantError("bad_input", "delegator and delegate must be addresses");
  if (input.names.length === 0) throw new GrantError("bad_input", "at least one name");
  if (input.actions.length === 0 || !input.actions.every(isActionId)) throw new GrantError("bad_input", "actions must be a non-empty list of known action ids");
  if (!Number.isInteger(input.maxCalls) || input.maxCalls < 1 || input.maxCalls > 10_000) throw new GrantError("bad_input", "maxCalls must be 1..10000");
  if (!Number.isFinite(input.ttlSeconds) || input.ttlSeconds < 60 || input.ttlSeconds > 90 * 86_400) throw new GrantError("bad_input", "ttlSeconds must be 60s..90d");
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const base: Omit<GrantV1, "names" | "hash"> = {
    version: GRANT_VERSION,
    chainId: input.chainId,
    delegator: getAddress(input.delegator),
    delegate: getAddress(input.delegate),
    delegationManager: getAddress(env.DelegationManager),
    resolver: getAddress(input.resolver ?? defaultResolver(input.chainId)),
    actions: [...new Set(input.actions)].sort(),
    notAfter: now + Math.floor(input.ttlSeconds),
    maxCalls: input.maxCalls,
    nonce: nonceHex(input.nonce),
  };
  const seen = new Set<string>();
  const names: GrantName[] = input.names.map((raw) => {
    const name = normalizeName(raw);
    if (seen.has(name)) throw new GrantError("bad_input", `duplicate name ${name}`);
    seen.add(name);
    const node = namehash(name) as Hex;
    return { name, node, delegation: unsignedDelegation(env, base, node) };
  });
  const grant: GrantV1 = { ...base, names, hash: "0x" };
  grant.hash = grantHash(grant);
  return grant;
}

/** Canonical JSON of the grant without signatures or hash; its keccak is `grant.hash`. */
export function canonicalUnsigned(g: Omit<GrantV1, "hash">): string {
  return JSON.stringify({
    version: g.version, chainId: g.chainId, delegator: g.delegator, delegate: g.delegate, delegationManager: g.delegationManager,
    resolver: g.resolver, actions: g.actions, notAfter: g.notAfter, maxCalls: g.maxCalls, nonce: g.nonce,
    names: g.names.map((n) => ({ name: n.name, node: n.node, salt: n.delegation.salt, authority: n.delegation.authority,
      caveats: n.delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })) })),
  });
}
export const grantHash = (g: Omit<GrantV1, "hash">): Hex => keccak256(stringToHex(canonicalUnsigned(g)));

/** EIP-712 payload for one name's delegation, for `eth_signTypedData_v4` in the owner's wallet. */
export function delegationTypedData(g: Pick<GrantV1, "chainId" | "delegationManager">, d: Delegation) {
  return {
    domain: { name: "DelegationManager", version: "1", chainId: g.chainId, verifyingContract: g.delegationManager },
    types: {
      Caveat: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }],
      Delegation: [
        { name: "delegate", type: "address" }, { name: "delegator", type: "address" }, { name: "authority", type: "bytes32" },
        { name: "caveats", type: "Caveat[]" }, { name: "salt", type: "uint256" },
      ],
    },
    primaryType: "Delegation" as const,
    message: {
      delegate: d.delegate, delegator: d.delegator, authority: d.authority,
      caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })), salt: BigInt(d.salt),
    },
  };
}

/** Attach wallet signatures, in `names` order. */
export function attachSignatures(g: GrantV1, signatures: Hex[]): GrantV1 {
  if (signatures.length !== g.names.length) throw new GrantError("bad_input", "one signature per name");
  return { ...g, names: g.names.map((n, i) => ({ ...n, delegation: { ...n.delegation, signature: signatures[i] } })) };
}

/** Sign every name's delegation with a raw private key (tests, scripts, and owners who run their own agent). */
export async function signGrantWithKey(g: GrantV1, privateKey: Hex): Promise<GrantV1> {
  const sigs: Hex[] = [];
  for (const n of g.names) {
    const { signature: _drop, ...unsigned } = n.delegation;
    sigs.push(await kitSignDelegation({ privateKey, delegation: unsigned, delegationManager: g.delegationManager, chainId: g.chainId }));
  }
  return attachSignatures(g, sigs);
}

// ------------------------------------------------------------------------------------------- encode / decode

export function encodeGrant(g: GrantV1): string {
  return JSON.stringify(g, null, 0);
}

/** Parse and structurally validate a grant blob. Throws GrantError on anything off. Does not touch the network. */
export function decodeGrant(blob: string | unknown): GrantV1 {
  let raw: unknown;
  try { raw = typeof blob === "string" ? JSON.parse(blob) : blob; } catch { throw new GrantError("malformed", "grant is not JSON"); }
  if (!raw || typeof raw !== "object") throw new GrantError("malformed", "grant is not an object");
  const g = raw as Record<string, unknown>;
  if (g.version !== GRANT_VERSION) throw new GrantError("bad_version", `unsupported grant version ${String(g.version)}`);
  if (!SUPPORTED_CHAINS.includes(g.chainId as SupportedChainId)) throw new GrantError("unsupported_chain", `chain ${String(g.chainId)}`);
  for (const k of ["delegator", "delegate", "delegationManager", "resolver"] as const) {
    if (typeof g[k] !== "string" || !isAddress(g[k] as string)) throw new GrantError("malformed", `${k} is not an address`);
  }
  if (!Array.isArray(g.actions) || g.actions.length === 0 || !g.actions.every(isActionId)) throw new GrantError("malformed", "actions");
  if (typeof g.notAfter !== "number" || !Number.isInteger(g.notAfter)) throw new GrantError("malformed", "notAfter");
  if (typeof g.maxCalls !== "number" || !Number.isInteger(g.maxCalls) || g.maxCalls < 1) throw new GrantError("malformed", "maxCalls");
  if (typeof g.nonce !== "string" || !isHex(g.nonce) || g.nonce.length !== 66) throw new GrantError("malformed", "nonce must be bytes32");
  if (!Array.isArray(g.names) || g.names.length === 0) throw new GrantError("malformed", "names");
  if (typeof g.hash !== "string" || !isHex(g.hash)) throw new GrantError("malformed", "hash");
  const names: GrantName[] = (g.names as unknown[]).map((n) => {
    const x = n as Record<string, unknown>;
    if (typeof x.name !== "string" || typeof x.node !== "string" || !isHex(x.node)) throw new GrantError("malformed", "names[].name/node");
    const d = x.delegation as Record<string, unknown> | undefined;
    if (!d || typeof d !== "object") throw new GrantError("malformed", "names[].delegation");
    for (const k of ["delegate", "delegator", "authority", "salt", "signature"] as const) if (typeof d[k] !== "string" || !isHex(d[k] as string)) throw new GrantError("malformed", `delegation.${k}`);
    if (!Array.isArray(d.caveats)) throw new GrantError("malformed", "delegation.caveats");
    const caveats = (d.caveats as unknown[]).map((c) => {
      const y = c as Record<string, unknown>;
      if (typeof y.enforcer !== "string" || !isAddress(y.enforcer) || typeof y.terms !== "string" || !isHex(y.terms)) throw new GrantError("malformed", "caveat");
      return { enforcer: getAddress(y.enforcer), terms: y.terms as Hex, args: (typeof y.args === "string" && isHex(y.args) ? y.args : "0x") as Hex };
    });
    return {
      name: x.name, node: x.node as Hex,
      delegation: { delegate: getAddress(d.delegate as string), delegator: getAddress(d.delegator as string), authority: d.authority as Hex, caveats, salt: d.salt as Hex, signature: d.signature as Hex },
    };
  });
  return {
    version: GRANT_VERSION, chainId: g.chainId as SupportedChainId,
    delegator: getAddress(g.delegator as string), delegate: getAddress(g.delegate as string),
    delegationManager: getAddress(g.delegationManager as string), resolver: getAddress(g.resolver as string),
    actions: [...(g.actions as ActionId[])], notAfter: g.notAfter, maxCalls: g.maxCalls, nonce: g.nonce as Hex, names, hash: g.hash as Hex,
  };
}

// -------------------------------------------------------------------------------------------------- describe

export interface GrantDescription {
  ok: boolean;
  problems: string[];
  /** Plain-language mandate, one line per fact the chain enforces. */
  summary: string[];
  hash: Hex;
  expired: boolean;
  signed: boolean;
  /** true when every delegation's EIP-712 signature recovers to `delegator` (EOA owners; 7702 keeps the EOA key). */
  signaturesValid: boolean | null;
}

/**
 * Rebuild the grant from its summary fields and compare every delegation byte-for-byte (enforcers, terms,
 * authority, salt). Anything the summary claims that the caveats do not enforce is reported as a problem, so the
 * mandate a UI displays is exactly the mandate the chain will apply. Offline; signature checks are EIP-712 recovery.
 */
export async function describeGrant(g: GrantV1, opts: { now?: number; verifySignatures?: boolean } = {}): Promise<GrantDescription> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const problems: string[] = [];
  const env = environmentFor(g.chainId);
  if (getAddress(env.DelegationManager) !== g.delegationManager) problems.push(`delegationManager ${g.delegationManager} is not the framework's ${env.DelegationManager} on chain ${g.chainId}`);
  if (g.delegator === g.delegate) problems.push("delegator and delegate are the same address");
  if (g.hash !== grantHash(g)) problems.push("hash does not match the grant's contents");

  const base: Omit<GrantV1, "names" | "hash"> = { version: g.version, chainId: g.chainId, delegator: g.delegator, delegate: g.delegate, delegationManager: g.delegationManager, resolver: g.resolver, actions: g.actions, notAfter: g.notAfter, maxCalls: g.maxCalls, nonce: g.nonce };
  let signed = true;
  let signaturesValid: boolean | null = opts.verifySignatures === false ? null : true;
  for (const n of g.names) {
    const norm = normalizeName(n.name);
    if (norm !== n.name) problems.push(`${n.name}: not normalised`);
    if ((namehash(norm) as Hex).toLowerCase() !== n.node.toLowerCase()) problems.push(`${n.name}: node does not match the name`);
    const expected = unsignedDelegation(env, base, n.node);
    const d = n.delegation;
    if (d.delegator !== g.delegator || d.delegate !== g.delegate) problems.push(`${n.name}: delegation parties differ from the grant`);
    if (d.authority.toLowerCase() !== expected.authority.toLowerCase()) problems.push(`${n.name}: authority is not root`);
    if (BigInt(d.salt) !== BigInt(expected.salt)) problems.push(`${n.name}: salt is not derived from nonce+node`);
    if (d.caveats.length !== expected.caveats.length) problems.push(`${n.name}: expected ${expected.caveats.length} caveats, found ${d.caveats.length}`);
    else expected.caveats.forEach((c, i) => {
      if (c.enforcer.toLowerCase() !== d.caveats[i].enforcer.toLowerCase() || c.terms.toLowerCase() !== d.caveats[i].terms.toLowerCase()) {
        problems.push(`${n.name}: caveat ${i} (${enforcerName(env, c.enforcer)}) does not match the summary`);
      }
    });
    if (!d.signature || d.signature === "0x") { signed = false; signaturesValid = null; }
    else if (signaturesValid !== null) {
      const ok = await verifyTypedData({ address: g.delegator, signature: d.signature, ...delegationTypedData(g, d) }).catch(() => false);
      if (!ok) { signaturesValid = false; problems.push(`${n.name}: signature does not recover to the delegator`); }
    }
  }
  const expired = now >= g.notAfter;
  if (expired) problems.push(`expired at ${new Date(g.notAfter * 1000).toISOString()}`);
  if (!signed) problems.push("unsigned: one or more delegations have no signature");

  const remaining = Math.max(0, g.notAfter - now);
  const summary = [
    `Session key ${g.delegate} may act for owner ${g.delegator} on Polygon (chain ${g.chainId}).`,
    `Names: ${g.names.map((n) => n.name).join(", ")}. Each call's first argument is pinned to that name's node; other names in the wallet are refused.`,
    `Actions: ${g.actions.map((a) => `${ACTIONS[a].functionName} (${ACTIONS[a].describe})`).join("; ")}. Only the AGTResolver at ${g.resolver}; the registry and controller are never callable.`,
    `Value: none. The scope carries a zero value cap, so no POL can move.`,
    `Until: ${new Date(g.notAfter * 1000).toISOString()}${expired ? " (expired)" : ` (${Math.floor(remaining / 60)} min left)`}.`,
    `Calls: at most ${g.maxCalls} successful redemption${g.maxCalls === 1 ? "" : "s"} per name. Reverted attempts do not count.`,
    `Revoke all: the owner bumps the NonceEnforcer nonce (grant nonce ${g.nonce}). Revoke one: DelegationManager.disableDelegation.`,
    `Grant hash ${g.hash}.`,
  ];
  return { ok: problems.length === 0, problems, summary, hash: g.hash, expired, signed, signaturesValid };
}

export function enforcerName(env: SmartAccountsEnvironment, address: string): string {
  const hit = Object.entries(env.caveatEnforcers).find(([, v]) => (v as string).toLowerCase() === address.toLowerCase());
  return hit?.[0] ?? address;
}
