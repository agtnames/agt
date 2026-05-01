# .agt Manifest Specification

**Version:** 1.0
**Status:** Draft (working toward GA)
**Date:** 2026-05-01

## Abstract

The .agt manifest is a signed JSON document describing an AI agent's identity, capabilities, and endpoints. Each manifest is content-addressed on IPFS and pointed to by a single DNS TXT record on the agent's `.agt` domain. The manifest is signed by the wallet that owns the underlying NFT, allowing any client to verify authorship without trusting any intermediary registry, gateway, or directory.

This specification replaces the pre-1.0 TXT-record manifest format that stored each field as a separate DNS TXT record. That format is documented as **legacy v0** in §10 — read-only support for the ~942 domains registered before this specification.

## 1. Versioning

This document specifies version 1.0. Each manifest declares its version in the `agt` field. Implementations MUST reject manifests whose version they do not support. Future versions are MUST be backward-compatible at the resolver level — the resolution algorithm in §6 produces a v1-shaped object even from legacy v0 records.

## 2. TXT Record

A v1 agent has exactly one `.agt`-related TXT record on the root of its domain:

```
agt-manifest=ipfs://<cid>
```

Where `<cid>` is a CIDv1 (RFC compliant, multibase-encoded, multihash-encoded) for the manifest JSON document. SHA-256 minimum. Other hash algorithms permitted but MUST be supported by mainstream IPFS gateways.

A domain MUST NOT have both `agt-manifest=` and legacy `agt-version=1` records simultaneously. Resolvers that encounter both MUST prefer the v1 manifest pointer.

## 3. Manifest Document

### 3.1 Required fields

| Field | Type | Description |
|---|---|---|
| `agt` | string | Spec version. MUST be `"1.0"` for this specification. |
| `domain` | string | Fully-qualified `.agt` domain. MUST match the domain hosting the TXT pointer. Lowercase. |
| `owner` | string | Owner wallet address. EIP-55 checksummed hex (e.g., `0x912D39E13b0bDAe2C5Cf5D0E2f9F4B38aE9c7f6a`). MUST match the on-chain NFT holder at the time the manifest is fetched. |
| `created_at` | string | ISO 8601 timestamp of manifest creation, with timezone offset (typically `Z`). |
| `signature` | string | EIP-191 signature over the canonical serialization of the manifest with the `signature` field removed. See §5. |

### 3.2 Optional identity fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Display name. Max 100 characters. |
| `description` | string | One-line description. Max 280 characters. |
| `icon` | string | URL to a square icon image (PNG, SVG, or JPG). HTTPS required. Recommended ≥128×128. |
| `website` | string | Agent homepage URL. HTTPS required. |

### 3.3 Protocols

`protocols` is an array of objects. Each object declares one protocol the agent speaks.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Protocol identifier. Lowercase, hyphenated. See §4. |
| `version` | string | no | Protocol-specific version (e.g., `"2025-11-05"` for MCP, `"1.0"` for A2A). |
| `endpoint` | string | yes | Endpoint URL for this protocol. HTTPS strongly recommended. |
| `auth` | string | no | Authentication scheme hint (`"none"`, `"bearer"`, `"oauth2"`, `"signed-nonce"`, etc.). Free-form. |

### 3.4 Capabilities

`capabilities` is an array of objects. Each object declares one capability and (optionally) the JSON Schema for its inputs and outputs.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Capability identifier. Lowercase, hyphenated. Vocabulary in §4.2. Custom IDs permitted. |
| `description` | string | no | One-line description. Max 200 characters. |
| `input` | object | no | JSON Schema (Draft 2020-12) describing the capability's input. |
| `output` | object | no | JSON Schema (Draft 2020-12) describing the capability's output. |

When `input` or `output` is present, it MUST validate as a syntactically correct JSON Schema. Implementations MAY use the schema for type checking, documentation generation, and compatibility evaluation.

### 3.5 Pricing

`pricing` is an object describing how the agent charges (or doesn't).

| Field | Type | Required | Description |
|---|---|---|---|
| `model` | string | yes | One of: `"free"`, `"freemium"`, `"paid"`, `"contact"`. |
| `free_tier` | string | no | Free-form description of the free tier (only meaningful with `freemium`). |
| `paid` | object | no | Required when `model` is `"paid"` or `"freemium"`. See below. |

`paid` object:

| Field | Type | Required | Description |
|---|---|---|---|
| `currency` | string | yes | ISO 4217 code (`"USD"`, `"EUR"`, `"GBP"`) or a token symbol (`"USDC"`, `"DAI"`). |
| `amount` | string | yes | Decimal amount as a string (avoids floating-point loss). E.g., `"0.01"`. |
| `unit` | string | yes | One of: `"per_request"`, `"per_token_in"`, `"per_token_out"`, `"per_minute"`, `"per_month"`, `"per_session"`, or a custom value. |
| `chain` | string | no | EIP-155 chain identifier (`"polygon"`, `"ethereum"`, `"base"`) when `currency` is a crypto token. |

### 3.6 Example

```json
{
  "agt": "1.0",
  "domain": "exampleagent.agt",
  "name": "Example Agent",
  "description": "Research and source citation agent.",
  "icon": "https://exampleagent.example.com/icon.png",
  "website": "https://exampleagent.example.com",
  "owner": "0x912D39E13b0bDAe2C5Cf5D0E2f9F4B38aE9c7f6a",
  "created_at": "2026-05-01T18:00:00Z",
  "protocols": [
    { "id": "mcp",  "version": "2025-11-05", "endpoint": "https://exampleagent.example.com/mcp" },
    { "id": "http", "endpoint": "https://exampleagent.example.com/api/v1", "auth": "bearer" }
  ],
  "capabilities": [
    {
      "id": "research",
      "description": "Searches academic and web sources, returns a cited summary.",
      "input":  { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] },
      "output": { "type": "object", "properties": { "summary": { "type": "string" }, "sources": { "type": "array" } } }
    },
    { "id": "summarization" }
  ],
  "pricing": {
    "model": "freemium",
    "free_tier": "10 queries/day",
    "paid": { "currency": "USD", "amount": "0.01", "unit": "per_request" }
  },
  "signature": "0x7f3e8d4c..."
}
```

## 4. Vocabularies

### 4.1 Protocols

| ID | Description |
|---|---|
| `mcp` | Model Context Protocol (Anthropic). Tool/context integration. |
| `a2a` | Agent-to-Agent Protocol (Google). Inter-agent communication. |
| `http` | REST or RPC over HTTP/HTTPS. Free-form. |
| `ws` | WebSocket. Real-time bidirectional. |
| `grpc` | gRPC. High-performance RPC. |

Custom protocol IDs are permitted. They MUST be lowercase, hyphenated identifiers. Implementations MAY warn on unknown IDs.

### 4.2 Capabilities

The site maintains a registered capability vocabulary at `/docs/agt-manifest-spec` (rendered from `src/lib/agent-capabilities.ts`). Custom capability IDs are permitted and MUST be lowercase, hyphenated. Capability IDs are not centrally allocated — duplication is possible. Tools that consume capabilities for matching SHOULD use the JSON Schemas in §3.4 rather than relying on string equality of IDs alone.

## 5. Canonical Serialization & Signing

### 5.1 Canonicalization

For signature creation and verification, manifests MUST be serialized using **RFC 8785 JSON Canonicalization Scheme (JCS)**:

- Keys at every nesting level sorted lexically by Unicode code-point.
- No insignificant whitespace.
- Numbers in shortest round-trippable form.
- Strings escaped per RFC 8259 §7 with the smallest valid escape sequence.

Implementations MUST use a JCS library or equivalent. Hand-rolled "minified JSON" is not sufficient.

### 5.2 Signing

1. Build the manifest object without the `signature` field.
2. Canonicalize per §5.1. Result: a UTF-8 byte sequence.
3. Sign per **EIP-191** (`personal_sign`) with the wallet that holds the domain's NFT.
4. Place the resulting hex signature (with `0x` prefix) in the `signature` field.

### 5.3 Verification

1. Fetch the manifest JSON.
2. Compare the IPFS CID computed from the fetched bytes against the CID in the TXT record. They MUST match. (This step prevents gateway tampering.)
3. Remove the `signature` field; canonicalize the remainder per §5.1.
4. Recover the signer address from the signature and the canonical bytes via EIP-191.
5. Compare against the `owner` field. They MUST match.
6. Compute the FNS tokenId for the domain: `tokenId = keccak256(bytes(tld) ++ keccak256(bytes(sld)))`.
7. Query `FNS.ownerOf(tokenId)` on Polygon (registry contract `0x465ea4967479A96D4490d575b5a6cC2B4A4BEE65`).
8. Compare against the `owner` field. They MUST match.

If any of steps 2, 5, 8 fails, the manifest is invalid and MUST be rejected.

## 6. Resolution Algorithm

```
function resolve(domain):
  records = dnsTxt(domain)
  pointer = records.find(r => r.startsWith("agt-manifest="))

  if pointer:
    cid = pointer.slice("agt-manifest=ipfs://".length)
    bytes = fetchFromIpfs(cid)
    if cidOf(bytes) != cid: REJECT (gateway tampering)
    json = parse(bytes)
    if !verifySignature(json): REJECT
    if !verifyOnChainOwner(json.domain, json.owner): REJECT
    return { manifest: json, source: "v1" }

  if records.has("agt-version=1"):
    return { manifest: parseLegacyV0(records), source: "v0-legacy", verified: false }

  return null
```

Resolvers MAY skip on-chain verification (step 8 of §5.3) when serving low-trust UI surfaces (e.g., a directory preview), but MUST clearly indicate "unverified" status. Steps 2 and 5 (CID hash + signature) MUST never be skipped — those are cheap and local.

## 7. Security Considerations

- **Public gateways are untrusted.** Resolvers MUST verify the IPFS CID matches the fetched content. A malicious or misbehaving gateway could otherwise return tampered bytes.
- **On-chain ownership is the ground truth.** Even with a valid signature, an old manifest signed by a previous owner is invalid after a transfer. Resolvers SHOULD verify against the current `ownerOf(tokenId)`.
- **Manifests are public and immutable.** They MUST NOT contain secrets, API keys, or anything not intended for permanent public record. Use endpoint authentication (e.g., per-client API keys delivered via the agent's HTTP endpoint) for confidential material.
- **Endpoint TLS.** Endpoints SHOULD use HTTPS. Clients SHOULD warn before connecting to plain HTTP endpoints.
- **Replay across versions.** A new version of a manifest gets a new CID, which gets a new TXT record, which becomes resolvable instantly. There is no caching guarantee at the IPFS layer beyond what the gateway provides. Resolvers MAY cache by `(domain, cid)` indefinitely (CIDs are content addresses).
- **Manifest size.** Implementations MUST accept manifests up to 64 KiB. Larger MAY be rejected. Most manifests will be well under 4 KiB.

## 8. Updating a Manifest

To change any field:

1. Edit the JSON.
2. Re-sign per §5.2 (new `created_at` recommended for clarity, but optional — the CID change is the canonical version identifier).
3. Pin the new JSON to IPFS, get a new CID.
4. Update the `agt-manifest=ipfs://<new-cid>` TXT record on the domain.

The previous CID remains pinned and resolvable indefinitely on IPFS, but the domain points at the latest version. Clients caching by `(domain, cid)` will see the new CID and re-fetch.

## 9. Error States

A resolver returns one of:

| State | Meaning |
|---|---|
| `manifest` (v1) | Valid v1 manifest. Verified. |
| `manifest` (v0-legacy) | Legacy TXT-record manifest. Unverified by design (no signature). |
| `not-an-agent` | Domain exists but has no agent records. |
| `not-found` | Domain does not exist. |
| `invalid-signature` | v1 manifest signature does not match owner. |
| `invalid-owner` | v1 manifest owner does not match on-chain NFT holder. |
| `invalid-cid` | IPFS gateway returned content that doesn't hash to the declared CID. |
| `unreachable` | IPFS gateway unreachable; manifest is presumed valid but uncached locally. |

## 10. Legacy v0 (TXT-only) Manifests

Approximately 942 domains were registered before this specification with the pre-1.0 TXT-record format. Those domains have an `agt-version=1` record and one TXT record per field. Format reference:

| Record | Purpose |
|---|---|
| `agt-version=1` | Sentinel; required for parsing. |
| `agt-name=<name>` | Display name. |
| `agt-description=<text>` | Description. |
| `agt-icon=<url>` | Icon URL. |
| `agt-website=<url>` | Website URL. |
| `agt-owner=<address>` | Declared owner (unverified — no signature). |
| `agt-protocol=<id>` | Repeatable. |
| `agt-cap=<id>` | Repeatable. |
| `agt-endpoint-<protocol>=<url>` | One per protocol. |
| `agt-pricing=<keyword>` | One of `free`/`paid`/`freemium`/`contact`. |

Resolvers SHOULD parse v0 records into a v1-shaped object with `legacy: true`. Writers MUST NOT generate new v0 manifests — the format is frozen for read-only legacy compatibility. A migration tool for legacy holders to upgrade in place is tracked in [#110](https://github.com/ds1/agt-site/issues/110).

## 11. Compatibility with A2A Agent Cards

A v1 manifest MAY include an `a2a` protocol with an endpoint that serves an A2A Agent Card at `/.well-known/agent.json`. The two formats are complementary: `.agt` provides identity, ownership, and discovery; A2A Agent Cards provide protocol-level capability negotiation between agents. Linking is optional.

## 12. References

- RFC 8785 — JSON Canonicalization Scheme (JCS)
- RFC 8259 — JSON Data Interchange Format
- EIP-191 — Signed Data Standard
- EIP-55 — Mixed-case checksum address encoding
- EIP-155 — Chain identifiers
- JSON Schema Draft 2020-12
- IPFS CIDv1 — multibase, multihash, multicodec
- FNS Registry contract: `0x465ea4967479A96D4490d575b5a6cC2B4A4BEE65` on Polygon
