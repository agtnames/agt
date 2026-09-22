/**
 * Pure resolution logic for the Snap (D-028): which names we look up, which chains we answer on, and what the send
 * flow gets back. `onNameLookup` in index.ts is a thin wrapper so this file is unit-testable without the Snap runtime.
 */
import { AgtResolver, checksumAddress, coinTypeForChain, type AddressRecord } from "@agtnames/resolver";

/** Where the registry lives. `agentWallet` is offered here only (see entriesFrom). */
export const HOME_CHAIN = "eip155:137";

/** CAIP-2 ids MetaMask calls us for (must match snap.manifest.json `endowment:name-lookup.chains`). */
export const SUPPORTED_CHAINS: readonly string[] = ["eip155:137", "eip155:1", "eip155:8453", "eip155:42161", "eip155:10", "eip155:56", "eip155:43114"];

/** Labels MetaMask shows next to each result (the extension also appends the Snap's name). */
export const PROTOCOL = "AGT Registry";
export const PROTOCOL_OWNER = "AGT Registry (owner account)";

/** One label, lowercase ASCII letters, digits and hyphens (punycode `xn--` included), then `.agt`. */
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.agt$/;
const EVM20 = /^0x[0-9a-f]{40}$/i;

/** One entry in MetaMask's `resolvedAddresses` list. */
export type ResolvedEntry = {
  resolvedAddress: string;
  protocol: string;
  domainName: string;
};

/** The records the Snap reads from a name. */
export type AddressRecords = Pick<AddressRecord, "active" | "addr" | "wallet" | "coinTypeAddr">;

/** What the Snap needs from the resolver; the tests substitute a fake. */
export type AddressSource = {
  resolveAddresses(name: string, opts: { coinType: bigint }): Promise<AddressRecords>;
  /** A contract account on Polygon (Safe, ERC-4337 account). An EIP-7702 delegated EOA is still key-controlled and is not one. */
  isContract(address: string): Promise<boolean>;
};

/**
 * The per-chain `addr(coinType)` record when it is a 20-byte EVM address.
 * @param rec - The records read from the name.
 * @returns The per-chain address, or null when unset or not an EVM address.
 */
export const overrideOf = (rec: AddressRecords): string | null => (rec.coinTypeAddr && EVM20.test(rec.coinTypeAddr) ? rec.coinTypeAddr : null);

/**
 * Whether the Snap answers on this network.
 * @param chainId - CAIP-2 id.
 * @returns True for the chains listed in the manifest.
 */
export const isSupportedChain = (chainId: string): boolean => SUPPORTED_CHAINS.includes(chainId);

/**
 * Numeric chain id of an `eip155:<n>` CAIP-2 id.
 * @param chainId - CAIP-2 id.
 * @returns The number, or null for non-EVM namespaces.
 */
export function chainNumber(chainId: string): number | null {
  const m = /^eip155:(\d+)$/.exec(chainId);
  return m ? Number(m[1]) : null;
}

/**
 * Trim, lowercase, drop a trailing dot.
 * @param input - The text typed in the send field.
 * @returns The `.agt` name to query, or null unless it is a single-label `.agt` name.
 */
export function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/\.$/, "");
  return DOMAIN_RE.test(d) ? d : null;
}

const same = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const entry = (address: string, protocol: string, domainName: string): ResolvedEntry => ({ resolvedAddress: checksumAddress(address), protocol, domainName });

/**
 * D-028 v2 (owner call 2026-09-21 after the probe):
 * - On Polygon the payment address the owner typed (`agentWallet`) leads, labelled by the registry; the connected
 * signer's `addr` follows as "owner account" only when it differs. Without an `agentWallet`, `addr` stands alone.
 * - On any other chain the entry is the name's address for that chain: `addr(node, coinType(chain))` when the owner
 * set one (ENSIP-11), else the default `addr` (lookupDomain refuses it for contract accounts). `agentWallet` is a
 * Polygon payment address and is never offered elsewhere.
 * - Nothing for inactive names or names with no address records.
 * @param domain - The normalized `.agt` name.
 * @param chainId - CAIP-2 id of the network the user is on.
 * @param rec - The records read from the name.
 * @returns The entries to show, in order.
 */
export function entriesFrom(domain: string, chainId: string, rec: AddressRecords): ResolvedEntry[] {
  if (!rec.active) return [];
  const chainAddr = overrideOf(rec) ?? rec.addr;
  if (chainId !== HOME_CHAIN) return chainAddr ? [entry(chainAddr, PROTOCOL, domain)] : [];
  const out: ResolvedEntry[] = [];
  if (rec.wallet) out.push(entry(rec.wallet, PROTOCOL, domain));
  if (chainAddr && !same(chainAddr, rec.wallet)) out.push(entry(chainAddr, rec.wallet ? PROTOCOL_OWNER : PROTOCOL, domain));
  return out;
}

let shared: AgtResolver | null = null;

/**
 * Polygon mainnet with the resolver's endpoint list; 4 s per endpoint and sticky failover keep a lookup inside
 * maxRequestTime (15 s).
 * @returns The shared resolver instance.
 */
export function defaultSource(): AddressSource {
  shared ??= new AgtResolver({ chain: "polygon", timeoutMs: 4_000 });
  return shared;
}

/**
 * The whole domain → addresses path.
 * @param domain - The text typed in the send field.
 * @param chainId - CAIP-2 id of the network the user is on.
 * @param source - Where records come from (the real resolver by default).
 * @returns The resolved addresses, or null (MetaMask shows nothing) for anything we do not answer.
 */
export async function lookupDomain(domain: string, chainId: string, source: AddressSource = defaultSource()): Promise<{ resolvedAddresses: ResolvedEntry[] } | null> {
  const n = chainNumber(chainId);
  if (n === null || !isSupportedChain(chainId)) return null;
  const name = normalizeDomain(domain);
  if (!name) return null;
  let rec: AddressRecords;
  try {
    rec = await source.resolveAddresses(name, { coinType: coinTypeForChain(n) });
  } catch {
    return null; // every RPC endpoint failed, or the registry did not answer: no answer beats a stale or guessed one
  }
  const resolvedAddresses = entriesFrom(name, chainId, rec);
  if (!resolvedAddresses.length) return null;
  // Off Polygon, without a per-chain record, the only thing we know is a Polygon address. A key-controlled account
  // (plain EOA, or an EIP-7702 delegated one) is the same account on every EVM chain; a contract account (Safe, 4337)
  // is not, and funds sent to it elsewhere can be unrecoverable. One eth_getCode on Polygon decides; on doubt (RPC
  // failure) we show nothing.
  if (chainId !== HOME_CHAIN && !overrideOf(rec) && rec.addr) {
    try {
      if (await source.isContract(rec.addr)) return null;
    } catch {
      return null;
    }
  }
  return { resolvedAddresses };
}
