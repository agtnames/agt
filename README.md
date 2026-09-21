# agt — open-source packages for .agt agent names

`.agt` names give AI agents a resolvable identity on Polygon: an owner, on-chain records, a signed manifest and endpoints (MCP, A2A, HTTP). This repository holds the public packages, the agent skill, the manifest specification and the registry manifests behind [agtnames.com](https://agtnames.com).

| Path | What | Install |
|---|---|---|
| [`packages/resolver`](packages/resolver) | `@agtnames/resolver`: resolve, verify and read manifests; A2A agent card and ERC-8004 export helpers; `agt-resolve` CLI | `npm i @agtnames/resolver` |
| [`packages/mcp`](packages/mcp) | `@agtnames/mcp`: MCP server (stdio) with five read-only tools; the hosted Streamable-HTTP endpoint is `https://agtnames.com/api/mcp` | `npx -y @agtnames/mcp` · `claude mcp add --transport http agt https://agtnames.com/api/mcp` |
| [`packages/countersign`](packages/countersign) | `@agtnames/countersign`: scoped session grants for record writes (EIP-7702 + Delegation Framework caveats) | `npm i @agtnames/countersign` |
| [`skills/agt-names`](skills/agt-names) | Agent skill teaching when and how to use the tools and the public API | `npx skills add agtnames/agt` |
| [`spec/`](spec) | The `.agt` manifest specification (v3 draft, v1 frozen); rendered at [agtnames.com/spec](https://agtnames.com/spec) | |
| [`gemini-extension.json`](gemini-extension.json) | Gemini CLI extension bundling the MCP server | `gemini extensions install https://github.com/agtnames/agt` |

Docs: [agtnames.com/docs](https://agtnames.com/docs) · Claude Code and other clients: [/docs/claude-code](https://agtnames.com/docs/claude-code) · framework snippets: [/docs/integrations](https://agtnames.com/docs/integrations).

## Registry listings

The MCP server is listed in the official MCP registry as `com.agtnames/agt` (`packages/mcp/server.json`), on Smithery (`packages/mcp/smithery.yaml`) and wherever else `packages/mcp/README.md` "Listed in" records.

## Development

Each package is its own npm project: `cd packages/<name> && npm ci && npm run build && npm test`. `packages/mcp` links its siblings with `file:` dependencies, so build `resolver` and `countersign` first. `.github/workflows/ci.yml` runs the same steps plus `node scripts/check-skills.mjs`.

Releases: tag `resolver-v*`, `countersign-v*` or `mcp-v*` (or run the `release` workflow by hand with `dry_run`). The workflow publishes every package whose version is not on npm yet through npm trusted publishing with provenance, then re-lists the MCP server with `mcp-publisher` (DNS-verified namespace). See the header of `.github/workflows/release.yml`.

## Security and contributing

Vulnerabilities: see [SECURITY.md](SECURITY.md). Issues and pull requests for anything in this repository are welcome here; see [CONTRIBUTING.md](CONTRIBUTING.md). Questions about the agtnames.com service itself go to the contact addresses on the site.

MIT, © 2026 AGT Domains LLC.
