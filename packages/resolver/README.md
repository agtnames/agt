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
| `chain` | Named chain: `"polygon"` (mainnet; the CLI/MCP default), `"amoy"`, `"localhost"`. Fills `rpcUrl`, `registry`, `resolver`, `fns` defaults |
| `rpcUrl` | Override the JSON-RPC endpoint |
| `registry` | Override the registry contract address (needed only for `localhost` or a custom deployment) |
| `ipfsGateway` | Gateway for `ipfs://` manifests |
| `timeoutMs` | Per-request timeout |
| `maxManifestBytes` | Cap on manifest size (default 256 KiB) |
| `legacyDns`, `dohUrl` | Opt-in DNS-over-HTTPS fallback for names that predate the registry (off by default) |

### `resolveAgent(name) → AgentResolution`

Returns `owner`, `registered` / `active` / `perpetual`, `records` (`addr`, `manifestUri`, `wallet`, `endpoints`, `texts`), `manifest` (+ `manifestSource`), `verified` / `reasons` / `signer`, and `source`.

`manifest` is typed as `AgtManifest` (spec v3): `description`, `icon`, `website`, `endpoints[]`, `capabilities[]`, `pricing` (`AgtPricing` — `model` is `free` / `freemium` / `paid` / `contact`), `payments[]`, `keys[]`, `delegation`, `registrations[]`. Only trust these fields when `verified` is `true`.

### `isAgent(name) → boolean`

Resolves a name and returns whether it has a valid, verified manifest.

## Chains

`CHAINS` exports the deployed Registry v2 addresses, so `new AgtResolver({ chain: "polygon" })` is a complete configuration:

| Chain | Registry | Resolver | Migration claim |
|---|---|---|---|
| `polygon` (137) | `0x5B9386C47395B0551c814cC03b69cbD20eb0C87A` | `0x66Ae037d2A6a770B4772b889b6cA1704504399f2` | `0x4276d03AcbcA433D257FBd90c53F090F4B16d38E` |
| `amoy` (80002) | `0xd08E0d9BCB26572Eaa22fe27Df53a5D2721D3BCD` | `0xE02f88b9BC0394742bBBe5c590E043B647B83419` | `0xC79A3fb86BcC3637BB58cDcd1f6E12Cf3fFDCBc8` |

`localhost` has no defaults; pass `{ rpcUrl, registry }`.

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
