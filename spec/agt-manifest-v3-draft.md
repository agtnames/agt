# .agt Manifest v3 (draft) — identity for the Registry v2 era

**Version:** 3.0 (draft) · **Date:** 2026-09-07 · **Status:** Testbed
**Supersedes:** v2 (`agt-manifest-v0.2.0.md`, JSON on IPFS, `"agt":"2.0"`) for names on **Registry v2**. v1 (inline TXT) and v2 remain readable by resolvers.

## Why a v3

v2 proved the shape (signed JSON on IPFS, one TXT pointer). v3 changes **where authority comes from** and **what an agent needs to be usable**:

1. **Trust root = AGT Registry v2**, not Freename's contract. Verification checks `signer == manifest.owner == AGTRegistry.ownerOf(tokenId)`.
2. **The pointer lives on-chain** (`AGTRegistry.manifestOf(tokenId)`); DNS TXT `agt-manifest=` becomes a projection of it.
3. **Agent-first fields**: signing keys (so agents can authenticate requests), typed endpoints (MCP/A2A/HTTP/WS), payment rails, delegation (agent acts for a principal), and interop registrations (e.g. ERC-8004).

## Document

```json
{
  "agt": "3.0",
  "name": "exampleagent.agt",
  "owner": "0x912D…7f6a",
  "updated": "2026-09-07T05:00:00Z",
  "description": "General-purpose research agent",
  "icon": "https://exampleagent.example/icon.png",
  "website": "https://exampleagent.example",
  "keys": [
    { "id": "sig-1", "purpose": "agent-auth", "type": "secp256k1", "publicKey": "0x04…", "revoked": false }
  ],
  "endpoints": [
    { "protocol": "mcp",  "url": "https://exampleagent.example/mcp", "version": "2025-11-05" },
    { "protocol": "a2a",  "url": "https://exampleagent.example/.well-known/agent.json" },
    { "protocol": "http", "url": "https://exampleagent.example/api/v1" }
  ],
  "capabilities": [
    { "id": "research", "description": "Searches sources and synthesizes findings",
      "input": { "type": "string" }, "output": { "type": "object", "properties": { "summary": { "type": "string" } } } },
    { "id": "summarization" }
  ],
  "pricing": { "model": "freemium", "free_tier": "10 queries/day",
               "paid": { "currency": "USDC", "amount": "0.01", "unit": "per_request", "chain": "polygon" } },
  "payments": [ { "rail": "x402", "chain": "polygon", "address": "0x912D…7f6a", "token": "USDC" } ],
  "delegation": { "principal": "0xABC…", "scope": ["read", "quote"], "expires": "2027-01-01T00:00:00Z" },
  "registrations": [ { "standard": "erc-8004", "chainId": 137, "registry": "0x8004…", "agentId": "42" } ],
  "signature": "0x…"
}
```

| Field | Req | Notes |
|---|---|---|
| `agt` | yes | `"3.0"` |
| `name` | yes | the `.agt` name this manifest describes |
| `owner` | yes | EVM address; must equal `AGTRegistry.ownerOf(tokenIdOf(label))` at verification time |
| `updated` | yes | ISO-8601; resolvers prefer the newest CID from the registry, not this field |
| `description`, `icon`, `website` | no | as v2 |
| `keys[]` | no | agent authentication keys; `purpose` ∈ `agent-auth`, `encryption`, custom; `revoked` flag; rotate by publishing a new manifest |
| `endpoints[]` | no | `protocol` ∈ `mcp`, `a2a`, `http`, `ws`, `grpc`, custom; `url`; optional `version` |
| `capabilities[]` | no | v2 vocabulary (69 ids / 8 categories) + custom; optional `input`/`output` schemas (v2 §3.4) |
| `pricing` | no | v2 §3.5 |
| `payments[]` | no | `rail` ∈ `x402`, `evm`, `lightning`, custom; `chain`, `address`, `token` |
| `delegation` | no | `principal` (address), `scope[]`, `expires` — "this agent acts for this principal" |
| `registrations[]` | no | interop identities (`erc-8004`, `did`, `ens`) |
| `signature` | yes on v2 registry | EIP-191 `personal_sign` over the canonical document without `signature` |

## Canonicalization & signature

1. Remove `signature`. 2. Serialize with keys sorted lexicographically at every level, no whitespace, UTF-8 (JCS-lite; RFC 8785 for full conformance). 3. `signature = personal_sign(canonicalBytes)` by the owner key (EIP-191: `keccak256("\x19Ethereum Signed Message:\n" + len + message)`). 4. Encode as `0x` hex (65 bytes, r‖s‖v).

**Verification (three-way):** recover signer from `signature` → must equal `owner` → must equal `AGTRegistry.ownerOf(tokenIdOf(label))`. Also verify the fetched bytes match the CID when the URI is `ipfs://`. Any failure → `verified: false` with reasons (do not reject the document; surface the status).

## Resolution algorithm (Registry v2)

1. `tokenId = uint256(keccak256(namehash("agt") ‖ keccak256(label)))`.
2. Read `ownerOf`, `expiryOf`/`isActive`, `manifestOf(tokenId)` from AGTRegistry.
3. If `manifestOf` is empty → fall back to DNS TXT (`agt-manifest=` → v2/v3 JSON; `agt-version=1` → v1 inline) for legacy names.
4. Fetch the URI (`ipfs://` via configurable gateways, `https://`, or `data:`), parse, verify per above.
5. Return `{ name, tokenId, owner, active, perpetual, manifest, verified, reasons }`.

## Projections

- **DNS TXT** (Handshake zone, written by the indexer): `agt-manifest=<uri>`; optional `agent-endpoint[mcp]=…` text records for ENSIP-25/26-style readers.
- **ERC-8004 registration file:** a v3 manifest can be served *as* the 8004 `agentURI` document by adding `"type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"` and `services[]` derived from `endpoints[]` (adapter does this; the manifest stays protocol-neutral).
- **A2A agent card:** `endpoints[protocol=a2a].url` points at it; v3 does not embed it.

## Security

- Signing is client-side; keys never leave the owner's wallet.
- A valid signature proves authorship *at signing time*; always resolve the current pointer from the registry.
- `keys[].revoked` + a new signed manifest is the rotation/revocation mechanism (the on-chain token is immutable; the manifest is not).
- Treat all manifest text as untrusted input in agent prompts (prompt-injection surface).
