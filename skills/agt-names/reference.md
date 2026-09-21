# .agt reference for agents

Everything here is public and keyless. Read routes are rate-limited per client; a 429 means back off. Full documentation: https://agtnames.com/docs/api-reference and https://agtnames.com/llms-full.txt.

## HTTP API (base `https://agtnames.com`)

| Route | Returns |
|---|---|
| `GET /api/v2/manifest/<label>` | the current manifest with `verified`, `manifestStatus`, `reasons` |
| `GET /api/agents?protocol=mcp&capability=research` | directory of verified agents filtered by protocol and capability id |
| `GET /api/v2/names?owner=0x…` | names held by a wallet |
| `GET /api/v2/activity?hours=24&limit=50` | registrations, migrations, gifts, renewals and manifest publishes |
| `GET /api/search?name=<label>` | availability and price |
| `GET /api/badge/<label>/shield.svg` | README shield: verified / registered / unknown |
| `GET /api/v2/agent-card/<label>` | A2A agent card built from the name's verified manifest (404 without an `a2a` endpoint) |
| `GET /activity/feed.xml`, `/activity/feed.json` | Atom and JSON Feed of the activity log |
| `GET /capabilities/<id>/feed.xml` | verified agents per capability |
| `GET /.well-known/agt.json` | registry descriptor: chain, contracts, API, feeds, install commands, spec |

Hosted manifests: `https://agts.dev/<label>.json` (may serve a stale document; cannot forge one, because verification checks the signature against the on-chain owner).

## CLI (`@agtnames/resolver`)

```sh
npx agt-resolve resolve <name>      # full resolution: owner, expiry, active, records, manifest, verified, reasons
npx agt-resolve record <name>       # on-chain record only
npx agt-resolve available <name>
npx agt-resolve text <name> <key>   # one text record
npx agt-resolve namehash <name>     # node + tokenId, no network
```

Flags: `--chain polygon|amoy|localhost`, `--rpc <url>`, `--registry 0x…`. With nothing set the CLI reads Polygon mainnet. Library: `import { AgtResolver } from "@agtnames/resolver"; await new AgtResolver({ chain: "polygon" }).resolveAgent("launchpad.agt")`.

## MCP server (`@agtnames/mcp`)

Start: `npx -y @agtnames/mcp` (stdio). Claude Code: `claude mcp add agt -- npx -y @agtnames/mcp`. Hosted Streamable-HTTP endpoint: `https://agtnames.com/api/mcp`.

| Tool | Returns |
|---|---|
| `agt_resolve` | owner, expiry, active/perpetual, records, verified manifest under `untrusted` |
| `agt_manifest` | manifest document plus `verified`, `manifestStatus`, `reasons` |
| `agt_endpoint` | URL for `mcp`, `a2a`, `http` or `ws`, plus `pricing` |
| `agt_available` | whether the name can be registered now |
| `agt_namehash` | node and token id (no network) |

Nine write tools (`agt_session_*`, `agt_set_*`) appear only when `AGT_SESSION_PASSPHRASE` is set; they redeem an owner-signed countersign grant for record writes and never move value.

## Manifest v3 fields

Required: `agt` (version), `name`, `owner` (0x address), `updated`, `signature`. Optional: `description`, `icon`, `website`, `keys[]` (`id`, `purpose`, `type`, `publicKey`, `revoked`), `endpoints[]` (`protocol` mcp | a2a | http | ws | grpc | custom, `url`, `version`), `capabilities[]` (`id` from the vocabulary or custom, `description`), `pricing` (`model` free | freemium | paid | contact), `payments[]` (`rail` x402 | evm | lightning | custom, `chain`, `address`, `token`), `delegation` (`principal`, `scope[]`, `expires`), `registrations[]` (`standard` erc-8004 | did | ens, `chainId`, `registry`, `agentId`).

Verified means: recovered signer == `manifest.owner` == on-chain owner (and for `ipfs://` pointers, the bytes hash to the CID). Spec: https://agtnames.com/spec.

## Errors

MCP tools return `{ "error": { "code", "message" } }` with `isError`: `invalid_name`, `rate_limited`, `timeout`, `rpc_unavailable`, `rpc_error`, `misconfigured`, `internal`. Manifest problems are never errors: the call succeeds with `verified: false` and `reasons`.
