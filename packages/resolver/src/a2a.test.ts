// Unit tests (no network): node --test dist/a2a.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentCardFrom, erc8004RegistrationFrom, A2A_PROTOCOL_VERSION, ERC8004_REGISTRATION_TYPE } from "./a2a.js";
import type { AgtManifest } from "./manifest.js";

const manifest: AgtManifest = {
  agt: "3.0", name: "notary.agt", owner: "0x37007a1c233f00b423bc0d177ac5b50ca9417596", updated: "2026-09-17T00:00:00Z",
  description: "Verifies what other agents claim.", icon: "https://agts.dev/notary.png", website: "https://notary.example",
  endpoints: [{ protocol: "a2a", url: "https://notary.example/a2a", version: "1.0" }, { protocol: "mcp", url: "https://notary.example/mcp" }, { protocol: "http", url: "https://notary.example/api" }],
  capabilities: [{ id: "fact-checking", description: "Checks claims against sources." }, { id: "access-control" }],
  payments: [{ rail: "x402", chain: "polygon", address: "0x37007a1c233f00b423bc0d177ac5b50ca9417596" }],
  registrations: [{ standard: "erc-8004", chainId: 137, registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", agentId: "42" }, { standard: "ens" }],
  signature: "0xsig",
};

test("agentCardFrom: verified manifest → full card (skills from capabilities, provider from website, icon, docs URL)", () => {
  const card = agentCardFrom({ name: "notary.agt", owner: manifest.owner, manifest, verified: true, endpoints: { a2a: "https://old.example/a2a" } });
  assert.ok(card);
  assert.equal(card.protocolVersion, A2A_PROTOCOL_VERSION);
  assert.equal(card.url, "https://notary.example/a2a", "the verified manifest's endpoint wins over the on-chain record");
  assert.equal(card.name, "notary.agt");
  assert.equal(card.description, "Verifies what other agents claim.");
  assert.equal(card.preferredTransport, "JSONRPC");
  assert.equal(card.version, "2026-09-17T00:00:00Z");
  assert.deepEqual(card.provider, { organization: "notary.example", url: "https://notary.example" });
  assert.equal(card.iconUrl, "https://agts.dev/notary.png");
  assert.equal(card.documentationUrl, "https://agtnames.com/name/notary");
  assert.deepEqual(card.skills, [
    { id: "fact-checking", name: "Fact Checking", description: "Checks claims against sources.", tags: ["fact-checking", "agt"] },
    { id: "access-control", name: "Access Control", description: "Access Control (capability id access-control in the .agt vocabulary).", tags: ["access-control", "agt"] },
  ]);
  assert.equal(card.supportsAuthenticatedExtendedCard, false);
  assert.deepEqual(Object.keys(card).sort(), ["capabilities", "defaultInputModes", "defaultOutputModes", "description", "documentationUrl", "iconUrl", "name", "preferredTransport", "protocolVersion", "provider", "skills", "supportsAuthenticatedExtendedCard", "url", "version"]);
});

test("agentCardFrom: unverified manifest → only the on-chain endpoint, no manifest claims", () => {
  const card = agentCardFrom({ name: "notary.agt", owner: manifest.owner, manifest, verified: false, endpoints: { a2a: "https://chain.example/a2a" } });
  assert.ok(card);
  assert.equal(card.url, "https://chain.example/a2a");
  assert.equal(card.skills.length, 0);
  assert.match(card.description, /not verified/);
  assert.equal(card.iconUrl, undefined);
  assert.deepEqual(card.provider, { organization: manifest.owner, url: "https://agtnames.com/name/notary" });
});

test("agentCardFrom: null without an a2a endpoint anywhere", () => {
  assert.equal(agentCardFrom({ name: "launchpad.agt", owner: "0x1", manifest: { ...manifest, endpoints: [{ protocol: "mcp", url: "https://x/mcp" }] }, verified: true, endpoints: { mcp: "https://x/mcp" } }), null);
  assert.equal(agentCardFrom({ name: "empty.agt", owner: null, manifest: null, verified: false }), null);
});

test("erc8004RegistrationFrom: services, x402, registrations, provenance", () => {
  const reg = erc8004RegistrationFrom(manifest, { manifestUri: "https://agts.dev/notary.json" });
  assert.equal(reg.type, ERC8004_REGISTRATION_TYPE);
  assert.equal(reg.name, "notary.agt");
  assert.equal(reg.description, "Verifies what other agents claim.");
  assert.equal(reg.image, "https://agts.dev/notary.png");
  assert.deepEqual(reg.services, [
    { name: "A2A", endpoint: "https://notary.example/a2a", version: "1.0" },
    { name: "MCP", endpoint: "https://notary.example/mcp" },
    { name: "web", endpoint: "https://notary.example/api" },
  ]);
  assert.equal(reg.x402Support, true);
  assert.equal(reg.active, true);
  assert.deepEqual(reg.registrations, [{ agentId: "42", agentRegistry: "eip155:137:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" }]);
  assert.deepEqual(reg.agt, { name: "notary.agt", owner: manifest.owner, manifest: "https://agts.dev/notary.json" });
});

test("erc8004RegistrationFrom: website becomes a web service only when no http endpoint exists; no payments → x402Support false", () => {
  const reg = erc8004RegistrationFrom({ agt: "3.0", name: "a.agt", owner: "0x1", website: "https://a.example" });
  assert.deepEqual(reg.services, [{ name: "web", endpoint: "https://a.example" }]);
  assert.equal(reg.x402Support, false);
  assert.deepEqual(reg.registrations, []);
  assert.equal("description" in reg, false);
});
