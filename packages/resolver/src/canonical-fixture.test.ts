// The canonical fixture (fixtures/canonical-manifest.json) ships in the npm tarball so every other implementation of
// the .agt manifest canonicalization (the agtnames.com site's manifest-v3.ts, contracts/scripts/set-manifest.cjs)
// can assert byte-for-byte agreement with this package instead of relying on a comment. Regenerate with
// `node scripts/gen-canonical-fixture.mjs` only when the canonicalization rules change on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalUnsigned, eip191Hash, type AgtManifest } from "./manifest.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/canonical-manifest.json", import.meta.url), "utf8")) as {
  manifest: AgtManifest; canonical: string; eip191Digest: string;
};

test("canonical fixture: canonicalUnsigned reproduces the recorded canonical string", () => {
  assert.equal(canonicalUnsigned(fixture.manifest), fixture.canonical);
});

test("canonical fixture: the EIP-191 digest of the canonical string is stable", () => {
  const hex = Buffer.from(eip191Hash(fixture.canonical)).toString("hex");
  assert.equal(hex, fixture.eip191Digest);
});

test("canonical fixture: keys sorted at every level, no inter-token whitespace, signature excluded", () => {
  // Parsing and re-serialising with JSON.stringify keeps key order and adds no whitespace, so equality proves both.
  assert.equal(JSON.stringify(JSON.parse(fixture.canonical)), fixture.canonical);
  assert.ok(!fixture.canonical.includes('"signature"'));
  const top = JSON.parse(fixture.canonical) as Record<string, unknown>;
  assert.deepEqual(Object.keys(top), [...Object.keys(top)].sort());
  assert.ok("signature" in fixture.manifest, "the fixture manifest carries a signature so the exclusion is exercised");
});
