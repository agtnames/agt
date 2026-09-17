// Protocol tests: spawn dist/index.js over stdio and talk to it with the SDK client. Offline unless AGT_LIVE_TEST=1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { VERSION } from "./config.js";

const DIST = fileURLToPath(new URL("./index.js", import.meta.url));
const execFileP = promisify(execFile);
const T = { timeout: 30_000 };

// Nothing here may reach a network: localhost chain, throwaway registry, a port nothing listens on.
const OFFLINE = { AGT_CHAIN: "localhost", AGT_REGISTRY: "0x0000000000000000000000000000000000000001", AGT_RPC_URL: "http://127.0.0.1:1" };

/** process.env minus every AGT_* key, plus overrides — as the string map the SDK wants. */
function env(overrides: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("AGT_")) out[k] = v;
  return { ...out, ...overrides };
}

async function connect(overrides: Record<string, string> = OFFLINE) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [DIST], env: env(overrides), stderr: "pipe" });
  const client = new Client({ name: "agt-mcp-test", version: "0" });
  await client.connect(transport);
  return client;
}

type Payload = Record<string, unknown> & { error?: { code: string; message: string } };
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; payload: Payload }> {
  const r = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { type: string; text?: string }[] };
  const text = r.content.find((c) => c.type === "text")?.text ?? "";
  return { isError: !!r.isError, payload: JSON.parse(text) as Payload };
}

test("initialize: server identifies as agt at the package version and publishes instructions", T, async () => {
  const client = await connect();
  try {
    assert.deepEqual(client.getServerVersion(), { name: "agt", version: VERSION });
    assert.match(client.getInstructions() ?? "", /verified/);
  } finally { await client.close(); }
});

test("tools/list: five read-only tools with titles, schemas and annotations", T, async () => {
  const client = await connect();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["agt_available", "agt_endpoint", "agt_manifest", "agt_namehash", "agt_resolve"]);
    for (const t of tools) {
      assert.ok(t.title, `${t.name} has a title`);
      assert.ok(t.description, `${t.name} has a description`);
      assert.ok((t.inputSchema as { properties?: Record<string, unknown> }).properties?.name, `${t.name} takes name`);
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name} is read-only`);
      assert.equal(t.annotations?.destructiveHint, false);
      assert.equal(t.annotations?.openWorldHint, t.name !== "agt_namehash", `${t.name} openWorldHint`);
    }
  } finally { await client.close(); }
});

test("agt_namehash: offline, matches the resolver's pinned constants", T, async () => {
  const client = await connect();
  try {
    const { isError, payload } = await call(client, "agt_namehash", { name: "ExampleAgent" });
    assert.equal(isError, false);
    assert.equal(payload.name, "exampleagent.agt");
    assert.equal(payload.node, "0x66597df49570b0f77ae73e536fbf417f27adc43851f854b6ffbda319d1fa8e44");
    assert.equal(payload.tokenId, "46294029256516673385415029889206496268839741955274474670679594236904799374916");
  } finally { await client.close(); }
});

test("errors: invalid_name before any network; rpc_unavailable when the RPC is unreachable", T, async () => {
  const client = await connect();
  try {
    const bad = await call(client, "agt_resolve", { name: "-bad" });
    assert.equal(bad.isError, true);
    assert.equal(bad.payload.error?.code, "invalid_name");
    const down = await call(client, "agt_available", { name: "foo" });
    assert.equal(down.isError, true);
    assert.equal(down.payload.error?.code, "rpc_unavailable", JSON.stringify(down.payload));
  } finally { await client.close(); }
});

test("misconfigured: localhost chain without a registry is reported as such", T, async () => {
  const client = await connect({ AGT_CHAIN: "localhost", AGT_RPC_URL: "http://127.0.0.1:1", AGT_REGISTRY: "" });
  try {
    const r = await call(client, "agt_available", { name: "foo" });
    assert.equal(r.isError, true);
    assert.equal(r.payload.error?.code, "misconfigured", JSON.stringify(r.payload));
  } finally { await client.close(); }
});

test("rate limit: AGT_RATE_PER_MIN=1 → second call is rate_limited", T, async () => {
  const client = await connect({ ...OFFLINE, AGT_RATE_PER_MIN: "1" });
  try {
    assert.equal((await call(client, "agt_namehash", { name: "a" })).isError, false);
    const second = await call(client, "agt_namehash", { name: "b" });
    assert.equal(second.isError, true);
    assert.equal(second.payload.error?.code, "rate_limited");
  } finally { await client.close(); }
});

test("--version / --help exit 0 before config is read (a bad gateway cannot break the health check)", T, async () => {
  const badEnv = env({ AGT_IPFS_GATEWAY: "https://evil.example/ipfs/" });
  const v = await execFileP(process.execPath, [DIST, "--version"], { env: badEnv });
  assert.equal(v.stdout.trim(), VERSION);
  const h = await execFileP(process.execPath, [DIST, "--help"], { env: badEnv });
  assert.match(h.stdout, /agt_resolve/);
  await assert.rejects(execFileP(process.execPath, [DIST], { env: badEnv, timeout: 5000 }), (e: unknown) => (e as { code?: number; stderr?: string }).code === 2 && /not allow-listed/.test((e as { stderr?: string }).stderr ?? ""));
});

test("shutdown: closing stdin ends the process with exit code 0", T, async () => {
  const p = spawn(process.execPath, [DIST], { env: env(OFFLINE), stdio: ["pipe", "pipe", "pipe"] });
  await new Promise<void>((res, rej) => { p.once("spawn", () => res()); p.once("error", rej); });
  // Let the server attach its stdin listeners before we hang up.
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n");
  await new Promise((r) => setTimeout(r, 500));
  p.stdin.end();
  const code = await Promise.race([
    new Promise<number | null>((r) => p.once("exit", (c) => r(c))),
    new Promise<string>((r) => setTimeout(() => r("timeout"), 5000)),
  ]);
  if (code === "timeout") p.kill();
  assert.equal(code, 0);
});

test("live: resolves launchpad.agt on Polygon mainnet with no configuration", { ...T, skip: process.env.AGT_LIVE_TEST !== "1" }, async () => {
  const client = await connect({});
  try {
    const { isError, payload } = await call(client, "agt_resolve", { name: "launchpad.agt" });
    assert.equal(isError, false, JSON.stringify(payload));
    assert.equal(payload.registered, true);
    assert.equal(payload.source, "registry-v2");
    assert.equal(payload.perpetual, true);
    assert.match(String(payload.owner), /^0x[0-9a-fA-F]{40}$/);
    assert.ok((payload.untrusted as { notice: string }).notice);
  } finally { await client.close(); }
});

// ------------------------------------------------------------------------- countersign write tools (opt-in)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildGrant, encodeGrant, signGrantWithKey } from "@agtnames/countersign";

const SESSION = { AGT_SESSION_PASSPHRASE: "correct horse battery staple" };

test("write tools are absent by default and present with AGT_SESSION_PASSPHRASE", T, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "agt-mcp-session-"));
  const client = await connect({ ...OFFLINE, ...SESSION, AGT_SESSION_DIR: dir });
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.equal(names.length, 14, names.join(","));
    for (const n of ["agt_session_new", "agt_session_import", "agt_session_status", "agt_session_forget", "agt_set_text", "agt_set_addr", "agt_set_endpoint", "agt_set_manifest_uri", "agt_set_wallet"]) assert.ok(names.includes(n), n);
    for (const t of tools.filter((t) => t.name.startsWith("agt_set_"))) {
      assert.equal(t.annotations?.readOnlyHint, false, `${t.name} is a write`);
      assert.equal(t.annotations?.destructiveHint, true, `${t.name} is destructive`);
      assert.ok((t.inputSchema as { properties?: Record<string, unknown> }).properties?.name, `${t.name} takes name`);
    }
  } finally { await client.close(); }
});

test("session flow offline: new key → import refuses foreign/expired grants → writes need a grant", T, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "agt-mcp-session-"));
  const client = await connect({ ...OFFLINE, ...SESSION, AGT_SESSION_DIR: dir });
  try {
    const noGrant = await call(client, "agt_set_text", { name: "countersignpoc", key: "url", value: "x" });
    assert.equal(noGrant.isError, true);
    assert.equal(noGrant.payload.error?.code, "misconfigured", JSON.stringify(noGrant.payload));

    const created = await call(client, "agt_session_new", {});
    assert.equal(created.isError, false, JSON.stringify(created.payload));
    const session = created.payload.sessionAddress as `0x${string}`;
    assert.match(session, /^0x[0-9a-fA-F]{40}$/);
    assert.equal((await call(client, "agt_session_new", {})).payload.created, false);

    const ownerPk = generatePrivateKey();
    const owner = privateKeyToAccount(ownerPk).address;
    const foreign = await signGrantWithKey(buildGrant({ chainId: 80002, delegator: owner, delegate: privateKeyToAccount(generatePrivateKey()).address, names: ["countersignpoc"], actions: ["text"], ttlSeconds: 3600, maxCalls: 3, nonce: 0n }), ownerPk);
    const refused = await call(client, "agt_session_import", { grant: encodeGrant(foreign) });
    assert.equal(refused.isError, true);
    assert.equal(refused.payload.error?.code, "grant_refused", JSON.stringify(refused.payload));

    const mine = await signGrantWithKey(buildGrant({ chainId: 80002, delegator: owner, delegate: session, names: ["countersignpoc", "notary"], actions: ["text", "endpoint"], ttlSeconds: 3600, maxCalls: 3, nonce: 0n }), ownerPk);
    const imported = await call(client, "agt_session_import", { grant: encodeGrant(mine) });
    assert.equal(imported.isError, false, JSON.stringify(imported.payload));
    assert.deepEqual(imported.payload.names, ["countersignpoc.agt", "notary.agt"]);
    assert.ok(Array.isArray(imported.payload.mandate));

    const notGranted = await call(client, "agt_set_addr", { name: "notary", address: owner });
    assert.equal(notGranted.isError, true);
    assert.equal(notGranted.payload.error?.code, "action_not_granted", JSON.stringify(notGranted.payload));
    const unknownName = await call(client, "agt_set_text", { name: "someoneelse", key: "url", value: "x" });
    assert.equal(unknownName.isError, true);
    assert.equal(unknownName.payload.error?.code, "unknown_name", JSON.stringify(unknownName.payload));

    const forgotten = await call(client, "agt_session_forget", { deleteKey: false });
    assert.equal(forgotten.payload.forgotten, true);
    const status = await call(client, "agt_session_status", {});
    assert.equal(status.payload.grant, null);
    assert.equal(status.payload.sessionAddress, session);
  } finally { await client.close(); }
});
