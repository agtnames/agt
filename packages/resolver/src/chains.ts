/**
 * Per-chain defaults. Registry v2 is live on Polygon mainnet (deployed 2026-09-11) and on the Amoy testnet; the
 * addresses below are the deployed proxies (source of truth: the operator's `_internal/deployments/<network>.json`,
 * all source-verified on Polygonscan). `{ registry }` / `AGT_REGISTRY` still override them for other deployments.
 * `localhost` stays `null` so nothing resolves against a made-up address.
 */
export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  /** Ordered public JSON-RPC endpoints tried until one answers (rpcUrl first). Wallet surfaces rely on the fallback. */
  rpcUrls?: readonly string[];
  /** AGTRegistryUpgradeable proxy (launch) or AGTRegistry (MVP). null = not deployed on this chain. */
  registry: string | null;
  /** AGTResolver deployed with the registry (also discoverable per name via registry.resolverOf). */
  resolver: string | null;
  /** AGTMigrationClaim, the Registry v1 → v2 migration contract (for tooling; the resolver never writes). */
  migrationClaim: string | null;
  /** Freename FNS ERC-721 on this chain (Registry v1), for legacy fallback. */
  fns: string | null;
  /** Block the registry was deployed at: the earliest block worth scanning for its events. */
  deployBlock: number | null;
}

export const CHAINS: Record<string, ChainConfig> = {
  polygon: {
    chainId: 137,
    name: "polygon",
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
    // All three answer batched eth_call arrays (checked 2026-09-21); polygon-rpc.com is retired (403) and is not listed.
    rpcUrls: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org", "https://1rpc.io/matic"],
    registry: "0x5B9386C47395B0551c814cC03b69cbD20eb0C87A",
    resolver: "0x66Ae037d2A6a770B4772b889b6cA1704504399f2",
    migrationClaim: "0x4276d03AcbcA433D257FBd90c53F090F4B16d38E",
    fns: "0x465ea4967479A96D4490d575b5a6cC2B4A4BEE65",
    deployBlock: 93590807,
  },
  amoy: {
    chainId: 80002,
    name: "amoy",
    rpcUrl: "https://polygon-amoy-bor-rpc.publicnode.com",
    registry: "0xd08E0d9BCB26572Eaa22fe27Df53a5D2721D3BCD",
    resolver: "0xE02f88b9BC0394742bBBe5c590E043B647B83419",
    migrationClaim: "0xC79A3fb86BcC3637BB58cDcd1f6E12Cf3fFDCBc8",
    fns: "0x2000Cc11bE76c9Fe9dF7d69B632c4c66A8a11872",
    deployBlock: 47170662,
  },
  localhost: {
    chainId: 31337,
    name: "localhost",
    rpcUrl: "http://127.0.0.1:8545",
    registry: null, // pass explicitly (testbed addresses change per run)
    resolver: null,
    migrationClaim: null,
    fns: null,
    deployBlock: null,
  },
};

export function chainByName(name: string): ChainConfig {
  const c = CHAINS[name.toLowerCase()];
  if (!c) throw new Error(`unknown chain "${name}" (known: ${Object.keys(CHAINS).join(", ")})`);
  return c;
}
