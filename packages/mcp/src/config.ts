/**
 * Configuration for @agtnames/mcp — read from the environment, validated, never exits the process.
 *
 * `loadConfig` throws `ConfigError` on a bad value so the entry point can print and exit, while tests can assert.
 * An empty string counts as unset: plugin `.mcp.json` files pass variables through as `${AGT_RPC_URL:-}`, which
 * expands to "" when the user has not set anything, and "" must mean "use the chain default".
 */
// Generated at build time (scripts/gen-version.mjs) so the constant survives bundling; committed alongside package.json.
import { VERSION } from "./version.js";
export { VERSION };

/**
 * Gateways the server may read `ipfs://` manifests from. With AGT_IPFS_GATEWAY unset every one is tried in this order
 * until one answers (#332: public gateways rate-limit; a CID's bytes are the same everywhere and are checked against
 * the CID). Setting AGT_IPFS_GATEWAY pins reads to that single gateway.
 */
export const GATEWAY_ALLOWLIST = ["https://gateway.pinata.cloud/ipfs/", "https://dweb.link/ipfs/", "https://ipfs.io/ipfs/", "https://w3s.link/ipfs/", "https://cloudflare-ipfs.com/ipfs/"] as const;

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = "ConfigError"; }
}

export interface Config {
  chain: string;
  rpcUrl?: string;
  registry?: string;
  fns?: string;
  legacy: boolean;
  /** First gateway that will be tried (the pinned one, or the head of the allow-list). */
  ipfsGateway: string;
  /** Every gateway that will be tried, in order: `[ipfsGateway]` when pinned, otherwise the allow-list. */
  ipfsGateways: readonly string[];
  dohUrl?: string;
  timeoutMs: number;
  maxManifestBytes: number;
  ratePerMin: number;
}

export const DEFAULTS = { chain: "polygon", timeoutMs: 10_000, maxManifestBytes: 256 * 1024, ratePerMin: 240 } as const;

/** Positive finite number from env, or the default when unset / not a number. */
function num(raw: string | undefined, d: number): number {
  if (raw === undefined) return d;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const get = (k: string): string | undefined => env[k] || undefined; // "" → unset
  const pinned = get("AGT_IPFS_GATEWAY")?.replace(/\/?$/, "/");
  if (pinned && !(GATEWAY_ALLOWLIST as readonly string[]).includes(pinned)) {
    throw new ConfigError(`AGT_IPFS_GATEWAY ${pinned} is not allow-listed (${GATEWAY_ALLOWLIST.join(", ")})`);
  }
  const gateways: readonly string[] = pinned ? [pinned] : GATEWAY_ALLOWLIST;
  return {
    chain: get("AGT_CHAIN") ?? DEFAULTS.chain,
    rpcUrl: get("AGT_RPC_URL"),
    registry: get("AGT_REGISTRY"),
    fns: get("AGT_FNS"),
    legacy: get("AGT_LEGACY") === "1",
    ipfsGateway: gateways[0],
    ipfsGateways: gateways,
    dohUrl: get("AGT_DOH_URL"),
    timeoutMs: num(get("AGT_TIMEOUT_MS"), DEFAULTS.timeoutMs),
    maxManifestBytes: num(get("AGT_MAX_MANIFEST"), DEFAULTS.maxManifestBytes),
    ratePerMin: num(get("AGT_RATE_PER_MIN"), DEFAULTS.ratePerMin),
  };
}

export const HELP = `@agtnames/mcp ${VERSION} — MCP server for .agt agent names (stdio, read-only by default)

Usage: agt-mcp [--version] [--help]
  Runs an MCP server over stdio. Any MCP-compatible client can launch it, e.g.
  claude mcp add agt -- npx -y @agtnames/mcp

Tools
  agt_resolve    name → owner, expiry, active/perpetual, records, verified manifest (+ reasons)
  agt_manifest   name → the manifest document only (verified flag + reasons)
  agt_endpoint   name, protocol → endpoint URL for mcp | a2a | http | ws
  agt_available  name → can it be registered right now
  agt_namehash   name → node + tokenId (no network)

Environment (all optional; Polygon mainnet works with none)
  AGT_CHAIN            polygon | amoy | localhost          (default polygon)
  AGT_RPC_URL          override the RPC endpoint
  AGT_REGISTRY         override the registry address (required only for localhost)
  AGT_FNS              legacy FNS address for AGT_LEGACY
  AGT_LEGACY=1         enable Registry v1 + DNS TXT fallbacks
  AGT_IPFS_GATEWAY     pin ipfs:// reads to one gateway; unset = try each in order:
                       ${GATEWAY_ALLOWLIST.join(" ")}
  AGT_DOH_URL          DoH endpoint for the DNS fallback
  AGT_TIMEOUT_MS       per-request timeout                  (default ${DEFAULTS.timeoutMs})
  AGT_MAX_MANIFEST     max manifest bytes                   (default ${DEFAULTS.maxManifestBytes})
  AGT_RATE_PER_MIN     tool calls per minute                (default ${DEFAULTS.ratePerMin})
  AGT_SESSION_PASSPHRASE  enables the countersign write tools (agt_session_*, agt_set_*): the local session key
                       is stored encrypted under AGT_SESSION_DIR (default ~/.agt/session) and redeems an
                       owner-signed grant; writes are bounded by the grant's on-chain caveats
`;
