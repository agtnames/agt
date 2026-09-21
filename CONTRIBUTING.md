# Contributing

Thanks for looking. This repository holds the public packages, skill and specification for `.agt` agent names; the agtnames.com site itself is developed in a private repository.

## Where things go

- **Bugs and feature requests for `@agtnames/resolver`, `@agtnames/mcp`, `@agtnames/countersign`, the `agt-names` skill or the manifest specification:** open an issue here.
- **Problems with the agtnames.com site, registration, billing or the hosted MCP endpoint (`https://agtnames.com/api/mcp`):** open an issue here too, and say which one; the maintainers route it.
- **Security reports:** follow [SECURITY.md](SECURITY.md). Please do not open a public issue for a vulnerability.

## Pull requests

- One change per PR, with tests. Each package runs `npm run build && npm test` (`node --test` over `dist/*.test.js`).
- `packages/mcp` depends on `../resolver` and `../countersign` through `file:` links; build those first.
- Keep `packages/mcp/server.json`, `smithery.yaml` and `gemini-extension.json` at the same version as `packages/mcp/package.json`; the tests and `scripts/publish-mcp.mjs` refuse otherwise.
- Public copy in this repository does not name the upstream registry vendor; describe it generically ("the registry"). `node scripts/check-skills.mjs` enforces this and the link rules in CI.
- Releases are cut by the maintainers by tagging (`resolver-v*`, `countersign-v*`, `mcp-v*`).

By contributing you agree that your contributions are licensed under the MIT license in [LICENSE](LICENSE).
