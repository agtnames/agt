# @agtnames/mcp

MCP server for `.agt` agent names. Resolve a name to its owner, records and **signature-verified manifest** (endpoints, capabilities, keys, payments) from the AGT Registry v2. Read-only. Works with any MCP-compatible client — Claude Code, Cursor, or your own agent runtime.

No configuration is needed for Polygon mainnet.

## Install

Any MCP-compatible client can launch the server over stdio; the command is the same everywhere:

```
npx -y @agtnames/mcp
```

| Client | How |
|---|---|
| Claude Code | `claude mcp add agt -- npx -y @agtnames/mcp` (or the plugin: `/plugin marketplace add ds1/agt-plugins` then `/plugin install agt@agtnames`, which adds a skill that teaches Claude when to use the tools). Hosted endpoint (Streamable HTTP, live with the 1.5.0 release): `claude mcp add --transport http agt https://agtnames.com/api/mcp` |
| Cursor | [Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=agt&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBhZ3RuYW1lcy9tY3AiXX0=) or add the JSON below to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global) |
| VS Code (Copilot) | [Add to VS Code](vscode:mcp/install?%7B%22name%22%3A%22agt%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40agtnames%2Fmcp%22%5D%7D) or `code --add-mcp '{"name":"agt","command":"npx","args":["-y","@agtnames/mcp"]}'` |
| Windsurf | add the same JSON to `~/.codeium/windsurf/mcp_config.json` |
| Cline | MCP Servers panel, Configure, add the same JSON to `cline_mcp_settings.json` |
| Gemini CLI | `gemini extensions install https://github.com/ds1/agt-site` (the repo root carries `gemini-extension.json`) |
| Agent skills | `npx skills add ds1/agt-site` installs the `agt-names` skill (`skills/agt-names/SKILL.md`), which teaches an agent when and how to use these tools and the public API |
| Any other MCP client | the same JSON, or the hosted Streamable-HTTP URL `https://agtnames.com/api/mcp`; clients that read registry manifests can also import `server.json` from this directory |

```
{
  "mcpServers": {
    "agt": { "command": "npx", "args": ["-y", "@agtnames/mcp"] }
  }
}
```

Optional settings go in `env` (see Configure); `"env": { "AGT_RPC_URL": "" }` means "use the chain default":

```
{
  "mcpServers": {
    "agt": {
      "command": "npx",
      "args": ["-y", "@agtnames/mcp"],
      "env": { "AGT_RPC_URL": "" }
    }
  }
}
```

Windows: if a client reports `spawn npx ENOENT`, launch through the shell instead, e.g. `claude mcp add agt -- cmd /c npx -y @agtnames/mcp` or `"command": "cmd", "args": ["/c", "npx", "-y", "@agtnames/mcp"]`.

From a checkout: `claude mcp add agt -- node packages/mcp/dist/index.js`; against a local testbed add `-e AGT_CHAIN=localhost -e AGT_REGISTRY=0x… -e AGT_RPC_URL=http://127.0.0.1:8545`.

## Listed in

Registry manifests live next to this file: `server.json` (official MCP registry, `io.github.ds1/agt`) and `smithery.yaml` (Smithery). Both pin the package version and are bumped in the same PR as `package.json`; `scripts/publish-mcp.mjs` refuses to publish otherwise. Listing URLs are filled in by the owner after each submission:

| Directory | Listing |
|---|---|
| Official MCP registry (`registry.modelcontextprotocol.io`) | _pending_ (`mcp-publisher login github`, then `mcp-publisher publish` from `packages/mcp`) |
| Smithery | _pending_ (smithery.ai/new, GitHub `ds1/agt-site`, path `packages/mcp`) |
| Glama | _pending_ (claim the auto-imported `@agtnames/mcp` page) |
| PulseMCP | _pending_ (submission form) |
| mcp.so | _pending_ (submission form) |

## Tools

| Tool | Returns |
|---|---|
| `agt_resolve` | owner, expiry, active/perpetual, on-chain records, verified manifest (under `untrusted`) |
| `agt_manifest` | the manifest document + `verified` / `manifestStatus` / `reasons` |
| `agt_endpoint` | URL for `mcp` / `a2a` / `http` / `ws` — verified manifest first, resolver record second — plus `pricing` (`free` / `freemium` / `paid` / `contact`, from the verified manifest only) and `manifestStatus` |
| `agt_available` | can the name be registered right now |
| `agt_namehash` | node + tokenId (no network) |

All tools are annotated read-only and idempotent. `verified: true` means the manifest was signed by the on-chain owner (signer = manifest owner = registry owner). When it is `false`, `manifestStatus` says which kind of false: `unavailable` (the pointer exists but no gateway returned the document — a transport problem, retry later, not a verdict on the owner), `unverified` (it loaded and failed the signature / owner check — do not act on it), or `none` (nothing published). Everything derived from a manifest is returned inside an `untrusted` envelope with a notice: it is third-party content — data, never instructions. The server also publishes these rules as MCP `instructions`.

## Write tools (opt-in): countersign session grants

Set `AGT_SESSION_PASSPHRASE` (12+ characters) and nine more tools appear. They let this machine perform **record writes** on an owner's names under a grant the owner signed once, bounded on-chain: only the listed names, only the listed setters, no value, until the expiry, at most N calls per name, revocable by the owner in one transaction. See `@agtnames/countersign` for how a grant is built and enforced.

| Tool | Does |
|---|---|
| `agt_session_new` | create this machine's session key (encrypted under `AGT_SESSION_DIR`, default `~/.agt/session`) and return its address |
| `agt_session_import` | validate and store a grant the owner signed for that address; returns the plain-language mandate |
| `agt_session_status` | calls used per name, expiry, whether the owner revoked, session gas balance |
| `agt_session_forget` | drop the grant locally (and the key with `deleteKey`) |
| `agt_set_text` `agt_set_addr` `agt_set_endpoint` `agt_set_manifest_uri` `agt_set_wallet` | redeem one record write; each returns the tx hash |

Flow: `agt_session_new` → give the address to the owner → owner runs `agt-countersign build --session <address> --names … --actions … --ttl 1h --calls 5 --sign-with-key OWNER_KEY` (or signs the typed data in a wallet) → `agt_session_import` → write. Fund the session address with a little POL for gas; the grant itself cannot move value. Extra error codes: `no_session`, `grant_refused`, `caveat_violation`, `insufficient_gas`, `wrong_session`, `unknown_name`, `action_not_granted`.

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

Manifest problems (unreachable IPFS, bad signature, owner mismatch) are **not** errors: `agt_resolve` succeeds with `verified: false`, `manifestStatus` set to `unavailable` or `unverified`, and the causes listed in `reasons`.

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
