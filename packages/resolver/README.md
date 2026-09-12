# @agtnames/resolver

Resolve and verify `.agt` agent names against the AGT Registry (Polygon). Reads the registry over raw JSON-RPC — no wallet library — and verifies the agent manifest three ways: the signer, the manifest's declared owner, and the on-chain owner must all agree. Works in Node.js, Deno, Bun, and browsers.

## Install

```
npm install @agtnames/resolver
```

## Quick start

```ts
import { AgtResolver } from "@agtnames/resolver";

const agt = new AgtResolver({ chain: "polygon" });   // or { rpcUrl, registry }
const r = await agt.resolveAgent("exampleagent.agt");

r.owner                 // '0x…' — current on-chain owner
r.active                // registered and not expired
r.verified              // manifest passed all checks
r.records.endpoints.mcp // 'https://…/mcp'
r.records.addr          // primary address record
r.manifest              // the full signed manifest (or null)
```

## API

### `new AgtResolver(options)`

| Option | Description |
|---|---|
| `chain` | Named chain (e.g. `"polygon"`); fills `rpcUrl` + `registry` defaults |
| `rpcUrl` | Override the JSON-RPC endpoint |
| `registry` | Override the registry contract address |
| `ipfsGateway` | Gateway for `ipfs://` manifests |
| `timeoutMs` | Per-request timeout |
| `maxManifestBytes` | Cap on manifest size (default 256 KiB) |
| `legacyDns`, `dohUrl` | Opt-in DNS-over-HTTPS fallback for names that predate the registry (off by default) |

### `resolveAgent(name) → AgentResolution`

Returns `owner`, `registered` / `active` / `perpetual`, `records` (`addr`, `manifestUri`, `wallet`, `endpoints`, `texts`), `manifest` (+ `manifestSource`), `verified` / `reasons` / `signer`, and `source`.

### `isAgent(name) → boolean`

Resolves a name and returns whether it has a valid, verified manifest.

## How resolution works

1. Derive the token ID from the name; read ownership, status, and the manifest pointer from the registry over JSON-RPC.
2. Fetch the manifest from its URI (`ipfs://`, `https://`, or `data:`) and verify it — signer, declared owner, and on-chain owner must agree, and `ipfs://` bytes must hash to the CID.
3. Optionally fall back to DNS-over-HTTPS for legacy names with no on-chain manifest (off by default).

## CLI

```
npx agt-resolve exampleagent.agt
```

Prints a name's resolution as JSON.

## Dependencies & runtimes

No wallet library, no framework — resolution is raw JSON-RPC plus `fetch`. The only dependencies are the audited `@noble/curves` and `@noble/hashes` primitives (signature recovery and hashing). Runs in Node.js, Deno, Bun, and browsers.

## License

MIT
