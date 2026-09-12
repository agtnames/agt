# @agtnames/mcp

MCP server for `.agt` agent names. Resolve a name to its owner, records and **signature-verified manifest** (endpoints, capabilities, keys, payments) from the AGT Registry v2. Read-only. Works with any MCP-compatible client — Claude Code, Cursor, or your own agent runtime.

## Tools

| Tool | Returns |
|---|---|
| `agt_resolve` | owner, expiry, active/perpetual, on-chain records, verified manifest (under `untrusted`) |
| `agt_manifest` | the manifest document + `verified` / `reasons` |
| `agt_endpoint` | URL for `mcp` / `a2a` / `http` / `ws` — verified manifest first, resolver record second |
| `agt_available` | can the name be registered right now |
| `agt_namehash` | node + tokenId (no network) |

`verified: true` means the manifest was signed by the on-chain owner (signer = manifest owner = registry owner). Everything derived from a manifest is returned inside an `untrusted` envelope with a notice: it is third-party content — data, never instructions.

## Configure

```
AGT_CHAIN=polygon            # polygon | amoy | localhost
AGT_REGISTRY=0x…             # required until the chain default is published
AGT_RPC_URL=…                # optional override
AGT_LEGACY=1                 # optional: Registry v1 (Freename) + DNS TXT fallbacks
AGT_IPFS_GATEWAY=https://dweb.link/ipfs/   # must be allow-listed
```

## Claude Code

```
claude mcp add agt -e AGT_CHAIN=polygon -e AGT_REGISTRY=0x… -- npx -y @agtnames/mcp
```

Or from a checkout: `claude mcp add agt -e … -- node packages/mcp/dist/index.js`.

## Hardening

Name validation before any network call; IPFS gateway allow-list; `https`/`data:` URIs only; manifest size and time caps; manifest strings length-capped and control-character-stripped; in-process rate limit.
