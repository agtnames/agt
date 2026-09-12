# @agtnames/mcp

MCP server for `.agt` agent names. Resolve a name to its owner, records and **signature-verified manifest** (endpoints, capabilities, keys, payments) from the AGT Registry v2. Read-only. Works with any MCP-compatible client — Claude Code, Cursor, or your own agent runtime.

No configuration is needed for Polygon mainnet.

## Install

Any MCP-compatible client: run the server over stdio.

```
npx -y @agtnames/mcp
```

Claude Code:

```
claude mcp add agt -- npx -y @agtnames/mcp
```

Or install the plugin, which bundles the server with a skill that teaches Claude when and how to use it: `/plugin marketplace add ds1/agt-plugins` then `/plugin install agt@agtnames`.

Windows: if Claude Code reports `spawn npx ENOENT`, register it through the shell instead: `claude mcp add agt -- cmd /c npx -y @agtnames/mcp`.

From a checkout: `claude mcp add agt -- node packages/mcp/dist/index.js`; against a local testbed add `-e AGT_CHAIN=localhost -e AGT_REGISTRY=0x… -e AGT_RPC_URL=http://127.0.0.1:8545`.

## Tools

| Tool | Returns |
|---|---|
| `agt_resolve` | owner, expiry, active/perpetual, on-chain records, verified manifest (under `untrusted`) |
| `agt_manifest` | the manifest document + `verified` / `reasons` |
| `agt_endpoint` | URL for `mcp` / `a2a` / `http` / `ws` — verified manifest first, resolver record second |
| `agt_available` | can the name be registered right now |
| `agt_namehash` | node + tokenId (no network) |

All tools are annotated read-only and idempotent. `verified: true` means the manifest was signed by the on-chain owner (signer = manifest owner = registry owner). Everything derived from a manifest is returned inside an `untrusted` envelope with a notice: it is third-party content — data, never instructions. The server also publishes these rules as MCP `instructions`.

## Errors

Failures come back as an MCP error result (`isError: true`) whose text is `{ "error": { "code", "message" } }`:

| code | meaning | what to do |
|---|---|---|
| `invalid_name` | label is not `[a-z0-9-]{1,63}` without leading/trailing hyphen | fix the name; nothing was sent to the network |
| `rate_limited` | more than `AGT_RATE_PER_MIN` calls in a minute from this process | back off; the bucket refills continuously |
| `timeout` | the RPC or IPFS request exceeded `AGT_TIMEOUT_MS` | retry; raise the timeout or set `AGT_RPC_URL` |
| `rpc_unavailable` | could not reach the RPC (DNS, connection refused, TLS, non-JSON reply) | check connectivity; set `AGT_RPC_URL` to another endpoint |
| `rpc_error` | the node answered with a JSON-RPC error (e.g. `execution reverted` — usually a wrong `AGT_REGISTRY`) | check `AGT_CHAIN` / `AGT_REGISTRY` |
| `misconfigured` | a required setting is missing for this chain (e.g. `localhost` without a registry) | set the variable named in the message |
| `internal` | anything else | report it with the message |

Manifest problems (unreachable IPFS, bad signature, owner mismatch) are **not** errors: `agt_resolve` succeeds with `verified: false` and the causes listed in `reasons`.

## Output size

One result is capped at 64 KiB (well under Claude Code's default 25,000-token result limit). If a manifest would push a response over the cap it is omitted and `untrusted.truncated` says so; fetch the manifest URI directly if you need it all. Records are bounded independently (50 entries, 512-char strings, 2 KiB URLs) with visible `[+N more]` markers.

## Configure

Everything is optional. `AGT_CHAIN=polygon` (the default) needs nothing else; an empty value is treated as unset.

```
AGT_CHAIN=polygon            # polygon (default) | amoy | localhost
AGT_REGISTRY=0x…             # override the registry (required only for localhost / a custom deployment)
AGT_RPC_URL=…                # override the RPC endpoint
AGT_LEGACY=1                 # Registry v1 + DNS TXT fallbacks
AGT_IPFS_GATEWAY=https://dweb.link/ipfs/   # must be allow-listed
AGT_TIMEOUT_MS=10000         # per-request timeout
AGT_MAX_MANIFEST=262144      # max manifest bytes
AGT_RATE_PER_MIN=240         # tool calls per minute before backing off
```

## Health check and troubleshooting

```
npx -y @agtnames/mcp --version      # prints the version and exits; works even if AGT_* is misconfigured
npx -y @agtnames/mcp --help
claude mcp get agt                  # Claude Code: how the server is registered and whether it connected
```

- `/mcp` inside Claude Code shows connection state; a server that fails to start prints its reason on stderr (`agt-mcp: …`) and exits 2.
- **Startup timeout.** The first `npx` run downloads the package; on a slow network that can exceed a low `MCP_TIMEOUT`. Pin a version (`@agtnames/mcp@1.1.0`) so later starts come from the local npx cache.
- **Two timeouts.** `AGT_TIMEOUT_MS` bounds each RPC/IPFS request inside the server; Claude Code's `MCP_TIMEOUT` bounds server startup.
- **Stale npx cache.** If `npx` fails with an odd module error, clear it: `npx clear-npx-cache` (or `npm cache clean --force`).
- Node 20 or newer is required (`fetch`, `AbortController`).

## Hardening

Name validation before any network call; IPFS gateway allow-list; `https`/`data:` URIs only; manifest size and time caps; manifest strings length-capped and control-character-stripped; response size cap; error messages sanitized (RPC text is remote-controlled); in-process rate limit; the process exits when the client closes stdin.

## Development

```
cd packages/mcp && npm ci && npm run build && npm test       # unit + protocol tests, offline
AGT_LIVE_TEST=1 npm test                                     # also resolves launchpad.agt on mainnet
node dist/index.js --version
```

Publishing (owner): `node scripts/publish-mcp.mjs --otp=<code>` from the repo root flips the `file:../resolver` dependency to the published range for the publish and restores it afterwards; `prepublishOnly` refuses to publish with a local dependency.
