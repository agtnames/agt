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

export interface ResolvedEntry {
  resolvedAddress: string;
  protocol: string;
  domainName: string;
}

export type AddressRecords = Pick<AddressRecord, "active" | "addr" | "wallet" | "coinTypeAddr">;

export interface AddressSource {
  resolveAddresses(name: string, opts: { coinType: bigint }): Promise<AddressRecords>;
  /** eth_getCode on Polygon is non-empty (Safe, ERC-4337 account, EIP-7702 delegation). */
  isContract(address: string): Promise<boolean>;
}

/** The per-chain `addr(coinType)` record when it is a 20-byte EVM address, else null. */
export const overrideOf = (rec: AddressRecords): string | null => (rec.coinTypeAddr && EVM20.test(rec.coinTypeAddr) ? rec.coinTypeAddr : null);

export const isSupportedChain = (chainId: string): boolean => SUPPORTED_CHAINS.includes(chainId);

/** `eip155:<n>` → n, else null. */
export function chainNumber(chainId: string): number | null {
  const m = /^eip155:(\d+)$/.exec(chainId);
  return m ? Number(m[1]) : null;
}

/** Trim, lowercase, drop a trailing dot; null unless it is a single-label `.agt` name we would query. */
export function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/\.$/, "");
  return DOMAIN_RE.test(d) ? d : null;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const entry = (address: string, protocol: string, domainName: string): ResolvedEntry => ({ resolvedAddress: checksumAddress(address), protocol, domainName });

/**
 * D-028 v2 (owner call 2026-09-21 after the probe):
 *  - On Polygon the payment address the owner typed (`agentWallet`) leads, labelled by the registry; the connected
 *    signer's `addr` follows as "owner account" only when it differs. Without an `agentWallet`, `addr` stands alone.
 *  - On any other chain the entry is the name's address for that chain: `addr(node, coinType(chain))` when the owner
 *    set one (ENSIP-11), else the default `addr` (lookupDomain refuses it for contract accounts). `agentWallet` is a
 *    Polygon payment address and is never offered elsewhere.
 *  - Nothing for inactive names or names with no address records.
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
/** Polygon mainnet with the resolver's endpoint list; 4 s per endpoint and sticky failover keep a lookup inside maxRequestTime (15 s). */
export function defaultSource(): AddressSource {
  shared ??= new AgtResolver({ chain: "polygon", timeoutMs: 4_000 });
  return shared;
}

/** The whole domain → addresses path. Returns null (MetaMask shows nothing) for anything we do not answer. */
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
  // Off Polygon, without a per-chain record, the only thing we know is a Polygon address. A key-controlled account is
  // the same account on every EVM chain; a contract account (Safe, 4337, 7702) is not, and funds sent to it elsewhere
  // can be unrecoverable. One eth_getCode on Polygon decides; on doubt (RPC failure) we show nothing.
  if (chainId !== HOME_CHAIN && !overrideOf(rec) && rec.addr) {
    try {
      if (await source.isContract(rec.addr)) return null;
    } catch {
      return null;
    }
  }
  return { resolvedAddresses };
}
