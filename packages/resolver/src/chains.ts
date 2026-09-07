/**
 * Per-chain defaults. Mainnet/Amoy registry addresses are filled in at deploy time —
 * they are deliberately `null` here so nothing resolves against a made-up address.
 */
export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  /** AGTRegistryUpgradeable proxy (launch) or AGTRegistry (MVP). null = not deployed yet. */
  registry: string | null;
  /** Freename FNS ERC-721 on this chain (Registry v1), for legacy fallback. */
  fns: string | null;
}

export const CHAINS: Record<string, ChainConfig> = {
  polygon: {
    chainId: 137,
    name: "polygon",
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
    registry: null, // set after the launch deploy (see _internal/deployments/polygon.json)
    fns: "0x465ea4967479A96D4490d575b5a6cC2B4A4BEE65",
  },
  amoy: {
    chainId: 80002,
    name: "amoy",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    registry: null,
    fns: null,
  },
  localhost: {
    chainId: 31337,
    name: "localhost",
    rpcUrl: "http://127.0.0.1:8545",
    registry: null, // pass explicitly (testbed addresses change per run)
    fns: null,
  },
};

export function chainByName(name: string): ChainConfig {
  const c = CHAINS[name.toLowerCase()];
  if (!c) throw new Error(`unknown chain "${name}" (known: ${Object.keys(CHAINS).join(", ")})`);
  return c;
}
