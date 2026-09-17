import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import {
  ACTIONS, buildGrant, decodeGrant, describeGrant, encodeAction, encodeGrant, enforcerName, grantHash, signGrantWithKey, GrantError,
} from "./index.js";

const ownerPk = generatePrivateKey();
const owner = privateKeyToAccount(ownerPk).address;
const session = privateKeyToAccount(generatePrivateKey()).address;
const NOW = 1_800_000_000;
const base = { chainId: 80002 as const, delegator: owner, delegate: session, names: ["countersignpoc", "notary.agt"], actions: ["text", "endpoint"] as const, ttlSeconds: 3600, maxCalls: 5, nonce: 1n, now: NOW };

test("buildGrant: one delegation per name, caveats in the enforced order, zero value scope", () => {
  const g = buildGrant({ ...base, actions: [...base.actions] });
  const env = getSmartAccountsEnvironment(80002);
  assert.equal(g.names.length, 2);
  assert.deepEqual(g.names.map((n) => n.name), ["countersignpoc.agt", "notary.agt"]);
  assert.equal(g.notAfter, NOW + 3600);
  assert.equal(g.nonce, "0x0000000000000000000000000000000000000000000000000000000000000001");
  const names = g.names[0].delegation.caveats.map((c) => enforcerName(env, c.enforcer));
  assert.deepEqual(names, [
    "AllowedTargetsEnforcer", "AllowedMethodsEnforcer", "ValueLteEnforcer", "AllowedCalldataEnforcer",
    "TimestampEnforcer", "LimitedCallsEnforcer", "RedeemerEnforcer", "NonceEnforcer",
  ]);
  // ValueLte terms must be zero: a grant can never move POL.
  const value = g.names[0].delegation.caveats[2];
  assert.equal(BigInt(value.terms), 0n);
  // AllowedTargets terms = the resolver only.
  assert.equal(g.names[0].delegation.caveats[0].terms.toLowerCase(), g.resolver.toLowerCase());
  // AllowedMethods terms = the two selectors, sorted by action id.
  assert.equal(g.names[0].delegation.caveats[1].terms.toLowerCase(), (ACTIONS.endpoint.selector + ACTIONS.text.selector.slice(2)).toLowerCase());
  // AllowedCalldata terms = startIndex(4) ‖ node.
  const cd = g.names[0].delegation.caveats[3].terms;
  assert.equal(BigInt("0x" + cd.slice(2, 66)), 4n);
  assert.equal(("0x" + cd.slice(66)).toLowerCase(), g.names[0].node.toLowerCase());
  // Distinct salts per name, deterministic across builds.
  assert.notEqual(g.names[0].delegation.salt, g.names[1].delegation.salt);
  const again = buildGrant({ ...base, actions: [...base.actions] });
  assert.equal(again.hash, g.hash);
});

test("buildGrant: rejects bad input", () => {
  assert.throws(() => buildGrant({ ...base, actions: [...base.actions], chainId: 1 as unknown as 137 }), (e: unknown) => e instanceof GrantError && e.code === "unsupported_chain");
  assert.throws(() => buildGrant({ ...base, actions: [] }), GrantError);
  assert.throws(() => buildGrant({ ...base, actions: ["text"], names: [] }), GrantError);
  assert.throws(() => buildGrant({ ...base, actions: ["text"], names: ["a", "a.agt"] }), /duplicate/);
  assert.throws(() => buildGrant({ ...base, actions: ["text"], maxCalls: 0 }), GrantError);
  assert.throws(() => buildGrant({ ...base, actions: ["text"], ttlSeconds: 10 }), GrantError);
  assert.throws(() => buildGrant({ ...base, actions: ["renew" as unknown as "text"] }), GrantError);
});

test("encode → decode round-trips and describe() passes on a signed grant", async () => {
  const g = await signGrantWithKey(buildGrant({ ...base, actions: [...base.actions] }), ownerPk);
  const back = decodeGrant(encodeGrant(g));
  assert.deepEqual(back, g);
  const d = await describeGrant(back, { now: NOW + 10 });
  assert.equal(d.ok, true, d.problems.join("; "));
  assert.equal(d.signed, true);
  assert.equal(d.signaturesValid, true);
  assert.match(d.summary.join("\n"), /countersignpoc\.agt, notary\.agt/);
  assert.match(d.summary.join("\n"), /Value: none/);
  assert.match(d.summary.join("\n"), /at most 5 successful redemptions per name/);
});

test("describe() reports an unsigned grant, an expired grant, and a foreign signature", async () => {
  const unsigned = buildGrant({ ...base, actions: [...base.actions] });
  const d1 = await describeGrant(unsigned, { now: NOW });
  assert.equal(d1.signed, false);
  assert.equal(d1.ok, false);
  const signed = await signGrantWithKey(unsigned, ownerPk);
  const d2 = await describeGrant(signed, { now: NOW + 4000 });
  assert.equal(d2.expired, true);
  assert.ok(d2.problems.some((p) => p.startsWith("expired")));
  const foreign = await signGrantWithKey(unsigned, generatePrivateKey());
  const d3 = await describeGrant(foreign, { now: NOW });
  assert.equal(d3.signaturesValid, false);
});

test("describe() catches a tampered caveat, a widened target, and a wrong hash", async () => {
  const g = await signGrantWithKey(buildGrant({ ...base, actions: [...base.actions] }), ownerPk);
  // Widen the value cap.
  const t1 = structuredClone(g);
  t1.names[0].delegation.caveats[2].terms = "0x00000000000000000000000000000000000000000000000000000000000f4240";
  const d1 = await describeGrant(t1, { now: NOW });
  assert.ok(d1.problems.some((p) => /ValueLteEnforcer/.test(p)), d1.problems.join("; "));
  // Point the target at the registry instead of the resolver (summary still says resolver).
  const t2 = structuredClone(g);
  t2.names[1].delegation.caveats[0].terms = "0xd08E0d9BCB26572Eaa22fe27Df53a5D2721D3BCD";
  const d2 = await describeGrant(t2, { now: NOW });
  assert.ok(d2.problems.some((p) => /AllowedTargetsEnforcer/.test(p)));
  // Change the summary without re-hashing.
  const t3 = { ...g, maxCalls: 500 };
  const d3 = await describeGrant(t3, { now: NOW });
  assert.ok(d3.problems.some((p) => /hash does not match/.test(p)));
  assert.ok(d3.problems.some((p) => /LimitedCallsEnforcer/.test(p)));
  assert.notEqual(grantHash(t3), g.hash);
});

test("decodeGrant: rejects wrong version, chain, and malformed blobs", () => {
  const g = buildGrant({ ...base, actions: [...base.actions] });
  assert.throws(() => decodeGrant("not json"), (e: unknown) => e instanceof GrantError && e.code === "malformed");
  assert.throws(() => decodeGrant({ ...g, version: 2 }), (e: unknown) => e instanceof GrantError && e.code === "bad_version");
  assert.throws(() => decodeGrant({ ...g, chainId: 1 }), (e: unknown) => e instanceof GrantError && e.code === "unsupported_chain");
  assert.throws(() => decodeGrant({ ...g, actions: ["renew"] }), (e: unknown) => e instanceof GrantError && e.code === "malformed");
  assert.throws(() => decodeGrant({ ...g, nonce: "0x01" }), /bytes32/);
});

test("encodeAction: every action encodes with the node first", () => {
  const node = "0x" + "11".repeat(32) as `0x${string}`;
  const encoded = [
    encodeAction(node, { action: "text", key: "url", value: "https://x" }),
    encodeAction(node, { action: "addr", address: owner }),
    encodeAction(node, { action: "manifest", uri: "https://agts.dev/x.json" }),
    encodeAction(node, { action: "endpoint", protocol: "mcp", url: "https://x/mcp" }),
    encodeAction(node, { action: "wallet", wallet: owner }),
    encodeAction(node, { action: "contenthash", hash: "0x1234" }),
    encodeAction(node, { action: "key", purpose: "agent-auth", pubkey: "0xabcd", version: 1, revoked: false }),
  ];
  for (const data of encoded) assert.equal(data.slice(10, 74), node.slice(2), "node must be the first ABI word (what AllowedCalldata pins)");
  assert.equal(encoded[0].slice(0, 10), ACTIONS.text.selector);
  assert.equal(encoded[2].slice(0, 10), ACTIONS.manifest.selector);
});
