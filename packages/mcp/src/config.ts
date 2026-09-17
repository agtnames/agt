/**
 * Configuration for @agtnames/mcp — read from the environment, validated, never exits the process.
 *
 * `loadConfig` throws `ConfigError` on a bad value so the entry point can print and exit, while tests can assert.
 * An empty string counts as unset: plugin `.mcp.json` files pass variables through as `${AGT_RPC_URL:-}`, which
 * expands to "" when the user has not set anything, and "" must mean "use the chain default".
 */
import { readFileSync } from "node:fs";

// Resolved relative to this module (dist/config.js or src/config.ts → ../package.json). No resolveJsonModule needed.
export const VERSION: string = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export const GATEWAY_ALLOWLIST = ["https://dweb.link/ipfs/", "https://ipfs.io/ipfs/", "https://cloudflare-ipfs.com/ipfs/", "https://w3s.link/ipfs/"] as const;

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = "ConfigError"; }
}

export interface Config {
  chain: string;
  rpcUrl?: string;
  registry?: string;
  fns?: string;
  legacy: boolean;
  ipfsGateway: string;
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
  const gateway = (get("AGT_IPFS_GATEWAY") ?? GATEWAY_ALLOWLIST[0]).replace(/\/?$/, "/");
  if (!(GATEWAY_ALLOWLIST as readonly string[]).includes(gateway)) {
    throw new ConfigError(`AGT_IPFS_GATEWAY ${gateway} is not allow-listed (${GATEWAY_ALLOWLIST.join(", ")})`);
  }
  return {
    chain: get("AGT_CHAIN") ?? DEFAULTS.chain,
    rpcUrl: get("AGT_RPC_URL"),
    registry: get("AGT_REGISTRY"),
    fns: get("AGT_FNS"),
    legacy: get("AGT_LEGACY") === "1",
    ipfsGateway: gateway,
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
  AGT_IPFS_GATEWAY     one of: ${GATEWAY_ALLOWLIST.join(" ")}
  AGT_DOH_URL          DoH endpoint for the DNS fallback
  AGT_TIMEOUT_MS       per-request timeout                  (default ${DEFAULTS.timeoutMs})
  AGT_MAX_MANIFEST     max manifest bytes                   (default ${DEFAULTS.maxManifestBytes})
  AGT_RATE_PER_MIN     tool calls per minute                (default ${DEFAULTS.ratePerMin})
  AGT_SESSION_PASSPHRASE  enables the countersign write tools (agt_session_*, agt_set_*): the local session key
                       is stored encrypted under AGT_SESSION_DIR (default ~/.agt/session) and redeems an
                       owner-signed grant; writes are bounded by the grant's on-chain caveats
`;
