#!/usr/bin/env node
// Regenerates fixtures/canonical-manifest.json from dist/ (run `npm run build` first). The fixture is consumed by
// canonical-fixture.test.ts here and by the site's manifest-v3 tests through the published tarball, so only
// regenerate it when the canonicalization rules change deliberately.
import { writeFileSync } from "node:fs";
import { canonicalUnsigned, eip191Hash } from "../dist/manifest.js";

const manifest = {
  agt: "3.0",
  name: "fixture.agt",
  owner: "0x37007a1c233f00b423bc0d177ac5b50ca9417596",
  updated: "2026-09-21T00:00:00Z",
  description: "Canonicalization fixture: nested objects, arrays, unicode (ü, 日本), empty string and numbers.",
  website: "https://agtnames.com",
  endpoints: [
    { protocol: "mcp", url: "https://fixture.example/mcp" },
    { protocol: "a2a", url: "https://fixture.example/a2a", auth: "none" },
  ],
  capabilities: [{ id: "research", tags: ["web", "citations"] }, { id: "summarize" }],
  payments: { rails: ["x402", "usdc-polygon"], address: "0x37007a1c233f00b423bc0d177ac5b50ca9417596", minUsd: 0.05 },
  keys: [{ kid: "k1", kty: "EC", crv: "secp256k1", x: "AA", y: "BB" }],
  zeta: 1,
  alpha: "",
  signature: "0xdeadbeef",
};

const canonical = canonicalUnsigned(manifest);
const eip191Digest = Buffer.from(eip191Hash(canonical)).toString("hex");
writeFileSync(new URL("../fixtures/canonical-manifest.json", import.meta.url), JSON.stringify({ manifest, canonical, eip191Digest }, null, 2) + "\n");
console.log(`fixtures/canonical-manifest.json: ${canonical.length} canonical bytes, digest ${eip191Digest}`);
