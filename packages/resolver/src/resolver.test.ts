// Unit tests (no network): node --test dist/resolver.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { namehash, tokenIdOf, normalizeName, labelOf, encString, decString } from "./abi.js";
import { canonicalize, signManifest, verifyManifest, recoverSigner, type AgtManifest } from "./manifest.js";
import { rawCidV1, verifyCid, cidFromUri, base32Encode, base32Decode } from "./cid.js";
import { inlineV1ToManifest } from "./dns.js";
import { chainByName, CHAINS } from "./chains.js";
import { AgtResolver } from "./index.js";

test("namehash matches the registry node scheme and normalizes names", () => {
  assert.equal(normalizeName("ExampleAgent"), "exampleagent.agt");
  assert.equal(normalizeName("exampleagent.agt."), "exampleagent.agt");
  assert.equal(labelOf("exampleagent.agt"), "exampleagent");
  // namehash("agt") root, then label
  assert.equal(namehash("exampleagent.agt"), "0x66597df49570b0f77ae73e536fbf417f27adc43851f854b6ffbda319d1fa8e44");
  assert.equal(tokenIdOf("exampleagent.agt").toString(), "46294029256516673385415029889206496268839741955274474670679594236904799374916");
});

test("string ABI encode/decode round-trips", () => {
  const { head, tail } = encString("agent-endpoint[mcp]", 1, 2);
  const data = "0x" + head + tail;
  // decode the tail as if it were a returned string (offset 32 → our tail)
  assert.equal(decString("0x" + "0".repeat(62) + "20" + tail), "agent-endpoint[mcp]");
  assert.equal(data.length > 2, true);
});

test("manifest sign → verify round-trip (EIP-191, JCS-lite)", () => {
  const pk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // hardhat account #1
  const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const unsigned: AgtManifest = { agt: "3.0", name: "exampleagent.agt", owner, endpoints: [{ protocol: "mcp", url: "https://x/mcp" }] };
  const signed = signManifest(unsigned, pk);
  assert.ok(signed.signature?.startsWith("0x"));
  const signer = recoverSigner(canonicalize(unsigned), signed.signature!);
  assert.equal(signer.toLowerCase(), owner.toLowerCase());
  assert.deepEqual(verifyManifest(signed, owner), { verified: true, signer: signer, reasons: [] });
  // tamper
  const tampered = { ...signed, endpoints: [{ protocol: "mcp", url: "https://evil/mcp" }] };
  assert.equal(verifyManifest(tampered, owner).verified, false);
  // wrong on-chain owner
  assert.equal(verifyManifest(signed, "0x000000000000000000000000000000000000dEaD").verified, false);
  // canonical form is key-sorted and whitespace-free
  assert.equal(canonicalize({ b: 1, a: [true, { d: null, c: "x" }] }), '{"a":[true,{"c":"x","d":null}],"b":1}');
});

test("raw CIDv1 compute + verify", () => {
  const bytes = new TextEncoder().encode('{"agt":"3.0"}');
  const cid = rawCidV1(bytes);
  assert.ok(cid.startsWith("bafkrei"), cid);
  assert.equal(cid.length, 59);
  assert.equal(verifyCid(cid, bytes), "match");
  assert.equal(verifyCid(cid, new TextEncoder().encode("x")), "mismatch");
  assert.equal(verifyCid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", bytes), "unsupported"); // CIDv0
  assert.equal(verifyCid(null, bytes), "not-ipfs");
  assert.equal(cidFromUri(`ipfs://${cid}/manifest.json`), cid);
  assert.equal(cidFromUri("https://x"), null);
  const rt = base32Decode(base32Encode(bytes));
  assert.deepEqual([...rt], [...bytes]);
});

test("Manifest v1 inline TXT lifts into a manifest-shaped object", () => {
  const m = inlineV1ToManifest("legacy.agt", {
    "agt-version": ["1"], "agt-name": ["Legacy"], "agt-owner": ["0xabc"], "agt-protocol": ["mcp"], "agt-cap": ["research", "summarization"],
    "agt-endpoint-mcp": ["https://legacy/mcp"],
  });
  assert.equal(m.agt, "1.0");
  assert.equal(m.legacy, true);
  assert.deepEqual(m.endpoints, [{ protocol: "mcp", url: "https://legacy/mcp" }]);
  assert.equal(m.capabilities.length, 2);
});

test("chain defaults carry the deployed Registry v2 addresses (mainnet + Amoy) and never invent one for localhost", () => {
  const ADDR = /^0x[0-9a-fA-F]{40}$/;
  const polygon = chainByName("polygon");
  assert.equal(polygon.registry, "0x5B9386C47395B0551c814cC03b69cbD20eb0C87A");
  assert.equal(polygon.resolver, "0x66Ae037d2A6a770B4772b889b6cA1704504399f2");
  assert.equal(polygon.migrationClaim, "0x4276d03AcbcA433D257FBd90c53F090F4B16d38E");
  assert.equal(polygon.fns, "0x465ea4967479A96D4490d575b5a6cC2B4A4BEE65");
  assert.equal(polygon.deployBlock, 93590807);
  for (const c of [CHAINS.polygon, CHAINS.amoy]) for (const k of ["registry", "resolver", "migrationClaim", "fns"] as const) assert.match(c[k]!, ADDR, `${c.name}.${k}`);
  assert.equal(CHAINS.localhost.registry, null);
  assert.throws(() => chainByName("nope"));
  // `{ chain: "polygon" }` alone is now a complete configuration; an explicit registry still wins.
  assert.equal(new AgtResolver({ chain: "polygon" }).cfg.registry, polygon.registry);
  assert.equal(new AgtResolver({ chain: "polygon", registry: "0x0000000000000000000000000000000000000001" }).cfg.registry, "0x0000000000000000000000000000000000000001");
  assert.throws(() => new AgtResolver({ chain: "localhost" }), /not deployed/);
});

// Live acceptance for #211 (opt-in: AGT_LIVE_TEST=1): with no registry configured, the mainnet default resolves a
// migrated name. launchpad.agt was the first mainnet migration (2026-09-11); agt.agt joins once the owner migrates it.
test("mainnet default resolves a live name with no env (AGT_LIVE_TEST=1)", { skip: process.env.AGT_LIVE_TEST !== "1" }, async () => {
  const r = await new AgtResolver({ chain: "polygon" }).resolve("launchpad.agt");
  assert.equal(r.registered, true);
  assert.equal(r.source, "registry-v2");
  assert.match(r.owner ?? "", /^0x[0-9a-fA-F]{40}$/);
});
