/**
 * Redeem a grant from the session key, and read its live status. Network side of the package.
 * Redemption goes through DelegationManager.redeemDelegations; the resolver sees the owner as msg.sender.
 * The session key pays gas only; the grant cannot move value.
 */
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Account, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon, polygonAmoy } from "viem/chains";
import { erc7710WalletActions } from "@metamask/smart-accounts-kit/actions";
import { ACTIONS, resolverAbi, type ActionId } from "./actions.js";
import { GrantError, environmentFor, type GrantV1 } from "./grant.js";

export const DEFAULT_RPC: Record<number, string> = {
  137: "https://polygon-bor-rpc.publicnode.com",
  80002: "https://polygon-amoy-bor-rpc.publicnode.com",
};
const chainOf = (id: number): Chain => (id === 137 ? polygon : polygonAmoy);

export type ActionArgs =
  | { action: "text"; key: string; value: string }
  | { action: "addr"; address: Address }
  | { action: "contenthash"; hash: Hex }
  | { action: "manifest"; uri: string }
  | { action: "endpoint"; protocol: string; url: string }
  | { action: "wallet"; wallet: Address }
  | { action: "key"; purpose: string; pubkey: Hex; version: number; revoked: boolean };

export function encodeAction(node: Hex, a: ActionArgs): Hex {
  switch (a.action) {
    case "text": return encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [node, a.key, a.value] });
    case "addr": return encodeFunctionData({ abi: resolverAbi, functionName: "setAddr", args: [node, a.address] });
    case "contenthash": return encodeFunctionData({ abi: resolverAbi, functionName: "setContenthash", args: [node, a.hash] });
    case "manifest": return encodeFunctionData({ abi: resolverAbi, functionName: "setAgentManifest", args: [node, a.uri] });
    case "endpoint": return encodeFunctionData({ abi: resolverAbi, functionName: "setAgentEndpoint", args: [node, a.protocol, a.url] });
    case "wallet": return encodeFunctionData({ abi: resolverAbi, functionName: "setAgentWallet", args: [node, a.wallet] });
    case "key": return encodeFunctionData({ abi: resolverAbi, functionName: "setAgentKey", args: [node, a.purpose, a.pubkey, a.version, a.revoked] });
  }
}

export interface RedeemOptions {
  /** Session key as a private key or a viem account. Must equal `grant.delegate`. */
  session: Hex | Account;
  rpcUrl?: string;
}

export class RedeemError extends Error {
  constructor(public readonly code: "wrong_session" | "unknown_name" | "action_not_granted" | "caveat_violation" | "insufficient_gas" | "rpc_error", message: string) {
    super(message); this.name = "RedeemError";
  }
}

const sessionAccount = (s: Hex | Account): Account => (typeof s === "string" ? privateKeyToAccount(s) : s);

/** Send one record write under the grant. Resolves to the tx hash once it is mined successfully. */
export async function redeem(grant: GrantV1, name: string, args: ActionArgs, opts: RedeemOptions): Promise<{ hash: Hex; blockNumber: bigint }> {
  const account = sessionAccount(opts.session);
  if (account.address.toLowerCase() !== grant.delegate.toLowerCase()) throw new RedeemError("wrong_session", `session ${account.address} is not the grant's delegate ${grant.delegate}`);
  const entry = grant.names.find((n) => n.name === name || n.name === `${name}.agt` || n.name === name.replace(/\.agt$/, "") + ".agt");
  if (!entry) throw new RedeemError("unknown_name", `${name} is not in this grant (${grant.names.map((n) => n.name).join(", ")})`);
  if (!grant.actions.includes(args.action)) throw new RedeemError("action_not_granted", `action ${args.action} (${ACTIONS[args.action as ActionId].functionName}) is not in this grant (${grant.actions.join(", ")})`);
  const env = environmentFor(grant.chainId);
  const chain = chainOf(grant.chainId);
  const transport = http(opts.rpcUrl ?? DEFAULT_RPC[grant.chainId]);
  const wallet = createWalletClient({ account, chain, transport }).extend(erc7710WalletActions());
  const pub = createPublicClient({ chain, transport });
  try {
    const hash = await wallet.sendTransactionWithDelegation({
      account, chain, to: grant.resolver, data: encodeAction(entry.node, args), value: 0n,
      permissionContext: [entry.delegation], delegationManager: env.DelegationManager,
    });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new RedeemError("caveat_violation", `redemption ${hash} reverted on-chain`);
    return { hash, blockNumber: r.blockNumber };
  } catch (e) {
    if (e instanceof RedeemError) throw e;
    const m = String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? e) + "\n" + String((e as { details?: string }).details ?? "");
    const reason = m.match(/[A-Za-z]+Enforcer:[a-z-]+|DelegationManager:[a-z-]+|NotAuthorised/)?.[0];
    if (reason) throw new RedeemError("caveat_violation", reason);
    if (/exceeds the balance|insufficient funds/i.test(m)) throw new RedeemError("insufficient_gas", "session key cannot pay gas");
    if (/reverted/i.test(m)) throw new RedeemError("caveat_violation", m.split("\n")[0]);
    throw new RedeemError("rpc_error", m.split("\n")[0]);
  }
}

// ------------------------------------------------------------------------------------------------- status

const statusAbi = parseAbi([
  "function currentNonce(address delegationManager, address delegator) view returns (uint256)",
  "function callCounts(address delegationManager, bytes32 delegationHash) view returns (uint256)",
  "function disabledDelegations(bytes32 delegationHash) view returns (bool)",
  "struct Caveat { address enforcer; bytes terms; bytes args; }",
  "struct Delegation { address delegate; address delegator; bytes32 authority; Caveat[] caveats; uint256 salt; bytes signature; }",
  "function getDelegationHash(Delegation _input) pure returns (bytes32)",
]);

export interface NameStatus { name: string; delegationHash: Hex; callsUsed: number; callsLeft: number; disabled: boolean }
export interface GrantStatus {
  chainId: number;
  now: number;
  expired: boolean;
  secondsLeft: number;
  /** false when the owner has bumped the nonce since signing: every name in the grant is dead. */
  nonceValid: boolean;
  ownerNonce: string;
  delegatorUpgraded: boolean;
  sessionBalanceWei: string;
  names: NameStatus[];
  /** Overall: usable right now for at least one name. */
  usable: boolean;
}

export async function grantStatus(grant: GrantV1, opts: { rpcUrl?: string; now?: number } = {}): Promise<GrantStatus> {
  const env = environmentFor(grant.chainId);
  const chain = chainOf(grant.chainId);
  const pub = createPublicClient({ chain, transport: http(opts.rpcUrl ?? DEFAULT_RPC[grant.chainId]) });
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const [ownerNonce, code, bal] = await Promise.all([
    pub.readContract({ address: env.caveatEnforcers.NonceEnforcer as Address, abi: statusAbi, functionName: "currentNonce", args: [env.DelegationManager as Address, grant.delegator] }),
    pub.getCode({ address: grant.delegator }),
    pub.getBalance({ address: grant.delegate }),
  ]);
  const names: NameStatus[] = [];
  for (const n of grant.names) {
    const d = n.delegation;
    const struct = { delegate: d.delegate, delegator: d.delegator, authority: d.authority, caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: c.args ?? "0x" })), salt: BigInt(d.salt), signature: d.signature };
    const delegationHash = await pub.readContract({ address: env.DelegationManager as Address, abi: statusAbi, functionName: "getDelegationHash", args: [struct] });
    const [used, disabled] = await Promise.all([
      pub.readContract({ address: env.caveatEnforcers.LimitedCallsEnforcer as Address, abi: statusAbi, functionName: "callCounts", args: [env.DelegationManager as Address, delegationHash] }),
      pub.readContract({ address: env.DelegationManager as Address, abi: statusAbi, functionName: "disabledDelegations", args: [delegationHash] }),
    ]);
    names.push({ name: n.name, delegationHash, callsUsed: Number(used), callsLeft: Math.max(0, grant.maxCalls - Number(used)), disabled });
  }
  const nonceValid = BigInt(grant.nonce) === ownerNonce;
  const expired = now >= grant.notAfter;
  return {
    chainId: grant.chainId, now, expired, secondsLeft: Math.max(0, grant.notAfter - now), nonceValid, ownerNonce: ownerNonce.toString(),
    delegatorUpgraded: !!code && code !== "0x", sessionBalanceWei: bal.toString(), names,
    usable: !expired && nonceValid && names.some((s) => !s.disabled && s.callsLeft > 0),
  };
}

export { GrantError };
