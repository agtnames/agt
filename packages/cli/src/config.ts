/**
 * Networks the CLI writes to. Registry and resolver come from @agtnames/resolver's CHAINS; the controller and USDC
 * addresses are the deployed proxies (source of truth: the operator's `_internal/deployments/<network>.json`).
 * `register` also takes the controller from the signed quote and refuses if the two disagree.
 */
import { CHAINS } from "@agtnames/resolver";
import type { Address, Chain } from "viem";
import { polygon, polygonAmoy } from "viem/chains";

export type NetworkName = "polygon" | "amoy";

export interface Network {
  name: NetworkName;
  chainId: number;
  chain: Chain;
  rpcUrls: string[];
  registry: Address;
  resolver: Address;
  controller: Address;
  usdc: Address;
  /** Site that issues quotes and hosts manifests. Amoy has no public site: pass --site (e.g. a local `next dev`). */
  site: string | null;
  explorer: string;
}

const NETWORKS: Record<NetworkName, Omit<Network, "rpcUrls">> = {
  polygon: {
    name: "polygon",
    chainId: 137,
    chain: polygon,
    registry: CHAINS.polygon.registry as Address,
    resolver: CHAINS.polygon.resolver as Address,
    controller: "0x875682c162eA6450b904d1A0AEe085cfb29b5C5C",
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    site: "https://agtnames.com",
    explorer: "https://polygonscan.com",
  },
  amoy: {
    name: "amoy",
    chainId: 80002,
    chain: polygonAmoy,
    registry: CHAINS.amoy.registry as Address,
    resolver: CHAINS.amoy.resolver as Address,
    controller: "0xbDBC4e0E934Cf39F6B6585c964eC8436dFD98791",
    usdc: "0xC8a4A34f1Ac295Fce267c4aCF0C5587e1061c9E4",
    site: null,
    explorer: "https://amoy.polygonscan.com",
  },
};

export interface NetworkOverrides { network?: string; rpc?: string; site?: string }

/** Flags win over the environment (AGT_NETWORK, AGT_RPC_URL, AGT_SITE), which wins over the defaults. */
export function networkFrom(o: NetworkOverrides, env: NodeJS.ProcessEnv = process.env): Network {
  const name = (o.network ?? env.AGT_NETWORK ?? "polygon").toLowerCase();
  if (name !== "polygon" && name !== "amoy") throw new Error(`unknown network "${name}" (use polygon or amoy)`);
  const base = NETWORKS[name];
  const rpc = o.rpc ?? env.AGT_RPC_URL;
  const defaults = CHAINS[name].rpcUrls ?? [CHAINS[name].rpcUrl];
  const site = (o.site ?? env.AGT_SITE ?? base.site)?.replace(/\/$/, "") ?? null;
  return { ...base, rpcUrls: rpc ? [rpc] : [...defaults], site };
}

export function requireSite(n: Network): string {
  if (!n.site) throw new Error(`${n.name} has no public site: pass --site <url> (or set AGT_SITE) for quotes and manifest hosting`);
  return n.site;
}

export const txUrl = (n: Network, hash: string) => `${n.explorer}/tx/${hash}`;
