// Unit tests for the local session store: node --test dist/session.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildGrant, signGrantWithKey, encodeGrant } from "@agtnames/countersign";
import { SessionStore, sessionConfig } from "./session.js";

const dir = () => mkdtempSync(path.join(tmpdir(), "agt-session-"));

test("sessionConfig: off without a passphrase, rejects a short one, defaults the dir", () => {
  assert.equal(sessionConfig({}), null);
  assert.equal(sessionConfig({ AGT_SESSION_PASSPHRASE: "" }), null);
  assert.throws(() => sessionConfig({ AGT_SESSION_PASSPHRASE: "short" }), /12 characters/);
  const c = sessionConfig({ AGT_SESSION_PASSPHRASE: "correct horse battery staple" })!;
  assert.match(c.dir, /[\\/]\.agt[\\/]session$/);
  assert.equal(sessionConfig({ AGT_SESSION_PASSPHRASE: "correct horse battery staple", AGT_SESSION_DIR: "/x/y" })!.dir, "/x/y");
});

test("SessionStore: key is created once, stored encrypted, decrypts with the right passphrase only", () => {
  const d = dir();
  const store = new SessionStore({ dir: d, passphrase: "correct horse battery staple" });
  assert.equal(store.address(), null);
  const a = store.ensureKey();
  assert.equal(a.created, true);
  const b = store.ensureKey();
  assert.equal(b.created, false);
  assert.equal(a.address, b.address);
  const onDisk = readFileSync(path.join(d, "session.json"), "utf8");
  assert.ok(!onDisk.includes(store.privateKey().slice(2)), "private key must not appear in plaintext on disk");
  assert.equal(privateKeyToAccount(store.privateKey()).address, a.address);
  const wrong = new SessionStore({ dir: d, passphrase: "not the passphrase at all" });
  assert.equal(wrong.address(), a.address, "address is readable without the passphrase");
  assert.throws(() => wrong.privateKey(), /does not unlock/);
});

test("SessionStore.importGrant: accepts a grant for this session, refuses another delegate, expired, or tampered", async () => {
  const d = dir();
  const store = new SessionStore({ dir: d, passphrase: "correct horse battery staple" });
  const ownerPk = generatePrivateKey();
  const owner = privateKeyToAccount(ownerPk).address;
  const NOW = 1_800_000_000;
  await assert.rejects(store.importGrant("{}"), /grant|version/i);
  const { address } = store.ensureKey();
  const mine = await signGrantWithKey(buildGrant({ chainId: 80002, delegator: owner, delegate: address, names: ["countersignpoc"], actions: ["text"], ttlSeconds: 3600, maxCalls: 3, nonce: 0n, now: NOW }), ownerPk);
  const other = await signGrantWithKey(buildGrant({ chainId: 80002, delegator: owner, delegate: privateKeyToAccount(generatePrivateKey()).address, names: ["countersignpoc"], actions: ["text"], ttlSeconds: 3600, maxCalls: 3, nonce: 0n, now: NOW }), ownerPk);
  await assert.rejects(store.importGrant(encodeGrant(other), NOW), /not this session/);
  await assert.rejects(store.importGrant(encodeGrant(mine), NOW + 4000), /expired/);
  const tampered = { ...mine, maxCalls: 999 };
  await assert.rejects(store.importGrant(JSON.stringify(tampered), NOW), /hash does not match/);
  const { grant, description } = await store.importGrant(encodeGrant(mine), NOW);
  assert.equal(grant.hash, mine.hash);
  assert.equal(description.ok, true);
  assert.ok(existsSync(path.join(d, "grant.json")));
  assert.equal(store.grant()?.hash, mine.hash);
  store.forget();
  assert.equal(store.grant(), null);
  assert.equal(store.address(), address, "forget() keeps the key unless asked");
  store.forget({ key: true });
  assert.equal(store.address(), null);
});
