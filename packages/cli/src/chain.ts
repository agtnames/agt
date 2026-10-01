/** Chain reads, record-write batching, and send → receipt → one printed verification line. */
import { namehash } from "@agtnames/resolver";
import { createPublicClient, encodeFunctionData, fallback, http, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { registryAbi, resolverAbi } from "./abi.js";
import { UsageError } from "./args.js";
import { txUrl, type Network } from "./config.js";
import type { Signer, TxRequest } from "./signer.js";

export function publicClient(n: Network): PublicClient {
  return createPublicClient({ chain: n.chain, transport: n.rpcUrls.length > 1 ? fallback(n.rpcUrls.map((u) => http(u))) : http(n.rpcUrls[0]) }) as PublicClient;
}

export function normalizeLabel(input: string): string {
  const label = input.trim().toLowerCase().replace(/\.agt$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) throw new UsageError(`"${input}" is not a valid .agt name: 1–63 characters, a-z 0-9 and hyphens, no leading or trailing hyphen`);
  return label;
}

export const nodeOf = (label: string): Hex => namehash(`${label}.agt`) as Hex;

export interface NameState { label: string; owner: Address | null; resolver: Address | null }

export async function nameState(pc: PublicClient, n: Network, label: string): Promise<NameState> {
  const tokenId = await pc.readContract({ address: n.registry, abi: registryAbi, functionName: "tokenIdOf", args: [label] });
  const owner = await pc.readContract({ address: n.registry, abi: registryAbi, functionName: "ownerOf", args: [tokenId] }).catch(() => null);
  const resolver = owner ? await pc.readContract({ address: n.registry, abi: registryAbi, functionName: "resolverOf", args: [tokenId] }).catch(() => null) : null;
  return { label, owner: owner && owner !== zeroAddress ? owner : null, resolver: resolver && resolver !== zeroAddress ? resolver : null };
}

/** The signer must own the name and the name must have a resolver, or every write would revert. */
export function assertOwner(s: NameState, signer: Address): Address {
  if (!s.owner) throw new Error(`${s.label}.agt is not registered (run \`agt register ${s.label}\` first)`);
  if (s.owner.toLowerCase() !== signer.toLowerCase()) throw new Error(`${s.label}.agt is owned by ${s.owner}, but you are signing as ${signer}. Sign with the owner's wallet.`);
  if (!s.resolver) throw new Error(`${s.label}.agt has no resolver (the name may have expired)`);
  return s.resolver;
}

export interface RecordsPlan {
  manifest?: string;
  endpoints?: { protocol: string; url: string }[];
  addr?: Address;
  wallet?: Address;
}

/** One multicall: pointer (skipped if unchanged), an endpoint per protocol, addr, agent wallet. */
export function recordCalls(label: string, plan: RecordsPlan, currentManifest = ""): Hex[] {
  const node = nodeOf(label);
  return [
    ...(plan.manifest && plan.manifest !== currentManifest ? [encodeFunctionData({ abi: resolverAbi, functionName: "setAgentManifest", args: [node, plan.manifest] })] : []),
    ...(plan.endpoints ?? []).map((e) => encodeFunctionData({ abi: resolverAbi, functionName: "setAgentEndpoint", args: [node, e.protocol, e.url] })),
    ...(plan.addr ? [encodeFunctionData({ abi: resolverAbi, functionName: "setAddr", args: [node, plan.addr] })] : []),
    ...(plan.wallet ? [encodeFunctionData({ abi: resolverAbi, functionName: "setAgentWallet", args: [node, plan.wallet] })] : []),
  ];
}

export function describePlan(label: string, plan: RecordsPlan, currentManifest = ""): string[] {
  return [
    ...(plan.manifest ? [plan.manifest === currentManifest ? `manifest pointer already ${plan.manifest} (unchanged)` : `manifest → ${plan.manifest}`] : []),
    ...(plan.endpoints ?? []).map((e) => `endpoint ${e.protocol} → ${e.url}`),
    ...(plan.addr ? [`addr → ${plan.addr}`] : []),
    ...(plan.wallet ? [`agent wallet → ${plan.wallet}`] : []),
  ].map((l) => `  ${label}.agt ${l}`);
}

export const multicallTx = (resolver: Address, calls: Hex[], description: string): TxRequest =>
  ({ to: resolver, data: encodeFunctionData({ abi: resolverAbi, functionName: "multicall", args: [calls] }), description });

export async function sendAndWait(pc: PublicClient, n: Network, signer: Signer, tx: TxRequest, log: (s: string) => void): Promise<Hex> {
  log(`→ ${tx.description}${signer.kind === "browser" ? " (approve in your wallet)" : ""}`);
  const hash = await signer.sendTransaction(tx);
  log(`  sent ${txUrl(n, hash)}`);
  const rc = await pc.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (rc.status !== "success") throw new Error(`transaction reverted: ${txUrl(n, hash)}`);
  log(`  confirmed in block ${rc.blockNumber}`);
  return hash;
}

/** What --dry-run prints for a transaction instead of sending it. */
export const dryTx = (tx: TxRequest, from: Address) =>
  ({ description: tx.description, from, to: tx.to, value: (tx.value ?? 0n).toString(), data: tx.data });
