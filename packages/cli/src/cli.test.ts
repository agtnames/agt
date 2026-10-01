/** Pure pieces: arguments, key checks, keyfiles, manifest build + sign, record batching, quote checks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize, verifyManifest } from "@agtnames/resolver";
import { decodeFunctionData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { controllerAbi, erc20Abi, resolverAbi } from "./abi.js";
import { parseAddressFlag, parseArgs, parseHttpsFlag, parseYears, UsageError } from "./args.js";
import { assertOwner, nodeOf, normalizeLabel, recordCalls } from "./chain.js";
import { networkFrom, requireSite } from "./config.js";
import { decryptKey, encryptKey, readKeyfile, writeKeyfile } from "./keyfile.js";
import { buildManifest, lintInput, MANIFEST_TEMPLATE, signManifestWith } from "./manifest.js";
import { checkQuote, planRegister, type SignedQuote } from "./register.js";
import { keySigner, parsePrivateKey } from "./signer.js";
import { checkEndpoint } from "./verify.js";

const polygon = networkFrom({}, {});
const amoy = networkFrom({ network: "amoy" }, {});

test("parseArgs: positionals, --k v, --k=v, booleans; unknown or valueless flags are usage errors", () => {
  const p = parseArgs(["manifest", "publish", "weather", "m.json", "--host=ipfs", "--dry-run", "--network", "amoy"]);
  assert.deepEqual(p.positionals, ["manifest", "publish", "weather", "m.json"]);
  assert.deepEqual(p.flags, { host: "ipfs", network: "amoy" });
  assert.ok(p.bools.has("dry-run"));
  assert.throws(() => parseArgs(["--bogus"]), UsageError);
  assert.throws(() => parseArgs(["--to"]), /needs a value/);
  assert.throws(() => parseArgs(["--to", "--dry-run"]), /needs a value/);
  assert.throws(() => parseArgs(["--json=1"]), /takes no value/);
});

test("flag validators", () => {
  assert.equal(parseYears(undefined), 1);
  assert.equal(parseYears("3"), 3);
  for (const bad of ["0", "11", "1.5", "x"]) assert.throws(() => parseYears(bad), UsageError);
  assert.throws(() => parseAddressFlag("0x" + "a".repeat(64), "to"), /looks like a private key/);
  assert.equal(parseAddressFlag("0x" + "a".repeat(40), "to"), "0x" + "a".repeat(40));
  assert.throws(() => parseHttpsFlag("http://x.example", "mcp"), /https/);
  assert.equal(parseHttpsFlag("wss://x.example/ws", "ws"), "wss://x.example/ws");
});

test("names normalize and invalid ones are usage errors", () => {
  assert.equal(normalizeLabel(" Weather.AGT "), "weather");
  for (const bad of ["-a", "a-", "a_b", "", "a".repeat(64)]) assert.throws(() => normalizeLabel(bad), UsageError);
});

test("parsePrivateKey explains the first-run traps", () => {
  const k = generatePrivateKey();
  assert.equal(parsePrivateKey(` ${k} `, "AGT_OWNER_KEY"), k);
  assert.throws(() => parsePrivateKey(k.slice(2), "AGT_OWNER_KEY"), /missing the 0x prefix/);
  assert.throws(() => parsePrivateKey(privateKeyToAccount(k).address, "AGT_OWNER_KEY"), /holds an address/);
  assert.throws(() => parsePrivateKey("correct horse battery staple", "AGT_OWNER_KEY"), /passphrase/);
  assert.throws(() => parsePrivateKey("0xabc", "AGT_OWNER_KEY"), /exactly 64/);
  assert.throws(() => parsePrivateKey(undefined, "AGT_OWNER_KEY"), /is empty/);
});

test("keyfile: round-trip, address in the clear, wrong passphrase fails, no overwrite", () => {
  const k = generatePrivateKey();
  const e = encryptKey(k, "a long enough passphrase");
  assert.equal(e.address, privateKeyToAccount(k).address);
  assert.ok(!JSON.stringify(e).includes(k.slice(2)), "the key is not stored in the clear");
  assert.equal(decryptKey(e, "a long enough passphrase"), k);
  assert.throws(() => decryptKey(e, "the wrong passphrase!"), /wrong passphrase/);
  assert.throws(() => encryptKey(k, "short"), /at least 12/);
  const dir = mkdtempSync(join(tmpdir(), "agt-cli-"));
  const f = join(dir, "owner.json");
  writeKeyfile(f, e);
  assert.equal(readKeyfile(f).address, e.address);
  assert.throws(() => writeKeyfile(f, e), /already exists/);
  writeFileSync(join(dir, "junk.json"), '{"v":2}');
  assert.throws(() => readKeyfile(join(dir, "junk.json")), /not an agt keyfile/);
});

test("manifest: build strips empties, fills identity, and a key signer's signature verifies three ways", async () => {
  const k = generatePrivateKey();
  const s = keySigner(k, polygon);
  const unsigned = buildManifest("weather", s.address, { description: "Forecasts", endpoints: [{ protocol: "mcp", url: "https://w.example/mcp" }, { protocol: "http", url: "" }], capabilities: [" Forecast "], payments: [{ rail: "x402" }], pricing: {} }, new Date("2026-09-30T00:00:00Z"));
  assert.deepEqual(unsigned, { agt: "3.0", name: "weather.agt", owner: s.address, updated: "2026-09-30T00:00:00.000Z", description: "Forecasts", endpoints: [{ protocol: "mcp", url: "https://w.example/mcp" }], capabilities: [{ id: "forecast" }] });
  const signed = await signManifestWith(s, unsigned);
  assert.equal(verifyManifest(signed, s.address).verified, true);
  assert.equal(await privateKeyToAccount(k).signMessage({ message: canonicalize(unsigned) }), signed.signature);
});

test("lintInput catches template leftovers and non-https endpoints", () => {
  const p = lintInput(MANIFEST_TEMPLATE);
  assert.ok(p.some((x) => /template text/.test(x)));
  assert.ok(p.some((x) => /template URL/.test(x)));
  assert.deepEqual(lintInput({ description: "ok", endpoints: [{ protocol: "mcp", url: "https://real.example/mcp" }] }), []);
  assert.ok(lintInput({ endpoints: [{ protocol: "mcp", url: "http://x.example" }] }).some((x) => /https/.test(x)));
});

test("recordCalls: one call per record, the manifest pointer skipped when unchanged", () => {
  const plan = { manifest: "https://agts.dev/w.json", endpoints: [{ protocol: "mcp", url: "https://w.example/mcp" }], addr: "0x0000000000000000000000000000000000000001" as const, wallet: "0x0000000000000000000000000000000000000002" as const };
  const calls = recordCalls("w", plan);
  const names = calls.map((d) => decodeFunctionData({ abi: resolverAbi, data: d }).functionName);
  assert.deepEqual(names, ["setAgentManifest", "setAgentEndpoint", "setAddr", "setAgentWallet"]);
  assert.equal(decodeFunctionData({ abi: resolverAbi, data: calls[0] }).args[0], nodeOf("w"));
  assert.equal(recordCalls("w", plan, plan.manifest).length, 3);
});

test("assertOwner: unregistered, someone else's, and no resolver", () => {
  const me = "0x00000000000000000000000000000000000000aa" as const;
  assert.throws(() => assertOwner({ label: "w", owner: null, resolver: null }, me), /not registered/);
  assert.throws(() => assertOwner({ label: "w", owner: "0x00000000000000000000000000000000000000bb", resolver: "0x00000000000000000000000000000000000000cc" }, me), /owned by/);
  assert.throws(() => assertOwner({ label: "w", owner: me, resolver: null }, me), /no resolver/);
  assert.equal(assertOwner({ label: "w", owner: me, resolver: "0x00000000000000000000000000000000000000cc" }, me), "0x00000000000000000000000000000000000000cc");
});

test("network config: polygon defaults, amoy needs --site, overrides win", () => {
  assert.equal(polygon.chainId, 137);
  assert.equal(requireSite(polygon), "https://agtnames.com");
  assert.throws(() => requireSite(amoy), /--site/);
  assert.equal(networkFrom({ network: "amoy", site: "http://localhost:3000/" }, {}).site, "http://localhost:3000");
  assert.deepEqual(networkFrom({ rpc: "https://rpc.example" }, {}).rpcUrls, ["https://rpc.example"]);
  assert.equal(networkFrom({}, { AGT_NETWORK: "amoy" }).chainId, 80002);
  assert.throws(() => networkFrom({ network: "base" }, {}), /unknown network/);
});

const me = "0x00000000000000000000000000000000000000aa" as const;
const quoteFor = (over: Partial<SignedQuote["quote"]> = {}, top: Partial<SignedQuote> = {}): SignedQuote => ({
  chainId: 137, controller: polygon.controller, currency: "USDC",
  quote: { label: "weather", to: me, payToken: polygon.usdc, price: "10000000", duration: String(365 * 86400), validUntil: String(Math.floor(Date.now() / 1000) + 900), nonce: ("0x" + "11".repeat(32)) as Hex, ...over },
  signature: ("0x" + "22".repeat(65)) as Hex, ...top,
});

test("checkQuote refuses anything that does not match the request or the network", () => {
  const ok = checkQuote(quoteFor(), { label: "weather", to: me }, polygon);
  assert.equal(ok.price, 10_000_000n);
  assert.throws(() => checkQuote(quoteFor({}, { chainId: 80002 }), { label: "weather", to: me }, polygon), /chain/);
  assert.throws(() => checkQuote(quoteFor({}, { controller: "0x00000000000000000000000000000000000000cc" }), { label: "weather", to: me }, polygon), /controller/);
  assert.throws(() => checkQuote(quoteFor({ label: "other" }), { label: "weather", to: me }, polygon), /not weather/);
  assert.throws(() => checkQuote(quoteFor({ to: "0x00000000000000000000000000000000000000bb" }), { label: "weather", to: me }, polygon), /mints to/);
  assert.throws(() => checkQuote(quoteFor({ payToken: "0x0000000000000000000000000000000000000000" }, { currency: "native" }), { label: "weather", to: me }, polygon), /USDC/);
  assert.throws(() => checkQuote(quoteFor({ validUntil: String(Math.floor(Date.now() / 1000) + 30) }), { label: "weather", to: me }, polygon), /expires/);
});

test("planRegister: approve only when the allowance is short, then register(quote, sig)", async () => {
  const q = quoteFor();
  const quote = checkQuote(q, { label: "weather", to: me }, polygon);
  const fakePc = (allowance: bigint) => ({ readContract: async ({ functionName }: { functionName: string }) => (functionName === "allowance" ? allowance : 50_000_000n) }) as never;
  const short = await planRegister(fakePc(0n), polygon, q, quote, me);
  assert.equal(short.txs.length, 2);
  const approve = decodeFunctionData({ abi: erc20Abi, data: short.txs[0].data });
  assert.deepEqual([approve.functionName, approve.args], ["approve", [polygon.controller, 10_000_000n]]);
  const reg = decodeFunctionData({ abi: controllerAbi, data: short.txs[1].data });
  assert.equal(reg.functionName, "register");
  assert.equal(short.txs[1].to, polygon.controller);
  assert.match(short.txs[1].description, /1 year \(10 USDC\)/);
  assert.equal((await planRegister(fakePc(10_000_000n), polygon, q, quote, me)).txs.length, 1);
});

test("checkEndpoint: /health first, then the endpoint itself below 500", async () => {
  const f = (map: Record<string, number | "throw">) => (async (u: string) => {
    const s = map[u]; if (s === "throw" || s === undefined) throw new Error("down");
    return new Response(null, { status: s });
  }) as unknown as typeof fetch;
  assert.deepEqual(await checkEndpoint("mcp", "https://a.example/mcp", f({ "https://a.example/health": 200 })), { protocol: "mcp", url: "https://a.example/mcp", live: true, via: "health", status: 200 });
  assert.equal((await checkEndpoint("mcp", "https://a.example/mcp", f({ "https://a.example/health": 404, "https://a.example/mcp": 405 }))).via, "endpoint");
  assert.equal((await checkEndpoint("mcp", "https://a.example/mcp", f({ "https://a.example/health": 502, "https://a.example/mcp": 503 }))).live, false);
  assert.equal((await checkEndpoint("mcp", "https://a.example/mcp", f({}))).error, "no response");
});
