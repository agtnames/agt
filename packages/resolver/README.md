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
| `ipfsGateways` | Ordered public gateways tried for `ipfs://` manifests until one answers (default `DEFAULT_IPFS_GATEWAYS`: pinata, dweb.link, ipfs.io, w3s.link). A 429 at one gateway is not a verdict on the document; the error names every gateway only when all fail |
| `ipfsGateway` | Pin reads to a single gateway (no fallback) |
| `timeoutMs` | Per-request timeout |
| `maxManifestBytes` | Cap on manifest size (default 256 KiB) |
| `legacyDns`, `dohUrl` | Opt-in DNS-over-HTTPS fallback for names that predate the registry (off by default) |

### `resolveAgent(name) → AgentResolution`

Returns `owner`, `registered` / `active` / `perpetual`, `records` (`addr`, `manifestUri`, `wallet`, `endpoints`, `texts`), `manifest` (+ `manifestSource`), `verified` / `manifestStatus` / `reasons` / `signer`, and `source`.

`manifestStatus` tells transport apart from trust: `verified`; `unverified` (the document loaded but failed the signature / owner / name check — do not act on it); `unavailable` (a pointer exists but the document could not be fetched from any gateway — retry later; this says nothing about the owner); `none` (no manifest published, or the name is not registered).

`manifest` is typed as `AgtManifest` (spec v3): `description`, `icon`, `website`, `endpoints[]`, `capabilities[]`, `pricing` (`AgtPricing` — `model` is `free` / `freemium` / `paid` / `contact`), `payments[]`, `keys[]`, `delegation`, `registrations[]`. Only trust these fields when `verified` is `true`.

### `isAgent(name) → boolean`

Resolves a name and returns whether it has a valid, verified manifest.

### `agentCardFrom({ name, owner, manifest, verified, endpoints }) → A2AAgentCard | null`

An A2A agent card (protocol 1.0 shape) for a name that publishes an `a2a` endpoint: `url` from the verified manifest (else the on-chain record), `skills[]` from the manifest capabilities, `provider` from the owner and website, `documentationUrl` to the name page. Manifest fields are used only when `verified` is true. Returns `null` without an `a2a` endpoint. agtnames.com serves the same card at `GET /api/v2/agent-card/<label>`, so ADK's `RemoteA2aAgent(agent_card=url)` and Microsoft Agent Framework's `A2AAgent(url=...)` can call a .agt agent by URL.

### `erc8004RegistrationFrom(manifest, { manifestUri?, active? }) → Erc8004Registration`

The JSON an ERC-8004 identity registration points at: `services[]` from the manifest endpoints (A2A, MCP, web), `x402Support` from the payment rails, `registrations[]` from `manifest.registrations` with standard `erc-8004`, plus an `agt` provenance block. Export today; on-chain registration is on the roadmap.

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
npx agt-resolve resolve exampleagent.agt        # full resolution as JSON
npx agt-resolve record exampleagent.agt         # on-chain record only
npx agt-resolve available exampleagent.agt
npx agt-resolve text exampleagent.agt url
npx agt-resolve namehash exampleagent.agt       # no network
npx agt-resolve card exampleagent.agt           # A2A agent card (exit 1 without an a2a endpoint)
npx agt-resolve export-8004 exampleagent.agt    # ERC-8004 registration JSON from the verified manifest
```

Flags: `--chain polygon|amoy|localhost`, `--rpc URL`, `--registry 0x…`, `--legacy`. Exit codes: 0 ok, 1 the lookup failed, 2 usage.

## Dependencies & runtimes

Resolution is raw JSON-RPC plus `fetch`, with no wallet library or framework required. The only dependencies are the audited `@noble/curves` and `@noble/hashes` primitives (signature recovery and hashing). Runs in Node.js, Deno, Bun, and browsers.

## License

MIT
