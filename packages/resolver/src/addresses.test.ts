// resolveAddresses: the wallet fast path (batched JSON-RPC, endpoint fallback, coinType) — no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AgtResolver } from "./index.js";
import { checksumAddress, coinTypeForChain, decBytes, encAddress, encUint, selector } from "./abi.js";
import { fetchManifestBytes } from "./manifest.js";

const REGISTRY = "0x5B9386C47395B0551c814cC03b69cbD20eb0C87A";
const RESOLVER = "0x66ae037d2a6a770b4772b889b6ca1704504399f2";
const ADDR = "0x37007a1c233f00b423bc0d177ac5b50ca9417596";
const WALLET = "0x7f4a455321af6cbbb8077d8e5245809958747566";
const PERPETUAL = (1n << 64n) - 1n;
const SEL = {
  expiryOf: selector("expiryOf(uint256)"),
  isActive: selector("isActive(uint256)"),
  resolverOf: selector("resolverOf(uint256)"),
  addr: selector("addr(bytes32)"),
  addrCoin: selector("addr(bytes32,uint256)"),
  agentWallet: selector("agentWallet(bytes32)"),
};
const abiBytes = (hex: string) => { const h = hex.replace(/^0x/, ""); return "0x" + encUint(32n) + encUint(BigInt(h.length / 2)) + h.padEnd(Math.ceil(h.length / 64) * 64, "0"); };

type Chain = { active: boolean; addr: string | null; wallet: string | null; coin?: string | null; resolverReverts?: boolean; registryReverts?: boolean; contracts?: string[]; delegated?: string[] };
type Call = { jsonrpc: string; id: number; method: string; params: [{ to: string; data: string } | string, string] };

/** Answer one eth_call (or eth_getCode) against a fake registry + resolver. */
function answer(chain: Chain, c: Call): { id: number; result?: string; error?: { code: number; message: string } } {
  if (c.method === "eth_getCode") {
    const who = String(c.params[0]).toLowerCase();
    if (chain.contracts?.map((a) => a.toLowerCase()).includes(who)) return { id: c.id, result: "0x6080604052" };
    if (chain.delegated?.map((a) => a.toLowerCase()).includes(who)) return { id: c.id, result: "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b" }; // EIP-7702 designator seen on mainnet 2026-09-22
    return { id: c.id, result: "0x" };
  }
  const { to, data } = c.params[0] as { to: string; data: string };
  const sel = data.slice(0, 10);
  const zero = "0x" + encUint(0n);
  if (to.toLowerCase() === REGISTRY.toLowerCase()) {
    if (chain.registryReverts) return { id: c.id, error: { code: 3, message: "execution reverted" } };
    if (sel === SEL.expiryOf) return { id: c.id, result: "0x" + encUint(chain.active ? PERPETUAL : 1n) };
    if (sel === SEL.isActive) return { id: c.id, result: "0x" + encUint(chain.active ? 1n : 0n) };
    if (sel === SEL.resolverOf) return chain.resolverReverts ? { id: c.id, error: { code: 3, message: "execution reverted" } } : { id: c.id, result: "0x" + encAddress(RESOLVER) };
  }
  if (to.toLowerCase() === RESOLVER) {
    if (sel === SEL.addr) return { id: c.id, result: chain.addr ? "0x" + encAddress(chain.addr) : zero };
    if (sel === SEL.agentWallet) return { id: c.id, result: chain.wallet ? "0x" + encAddress(chain.wallet) : zero };
    if (sel === SEL.addrCoin) return { id: c.id, result: chain.coin ? abiBytes(chain.coin) : abiBytes("") };
  }
  return { id: c.id, error: { code: -32000, message: `unexpected call ${sel} to ${to}` } };
}

/** Install a fetch mock. `hosts` maps a host to a behaviour: "ok" answers batches, "network" throws, "http500" answers 500, "single" answers a batch with one object. */
function mockRpc(chain: Chain, hosts: Record<string, "ok" | "network" | "http500" | "single">) {
  const seen: Array<{ host: string; batch: number }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const host = new URL(String(url)).host;
    const body = JSON.parse(String(init?.body)) as Call | Call[];
    const calls = Array.isArray(body) ? body : [body];
    seen.push({ host, batch: Array.isArray(body) ? calls.length : 0 });
    const mode = hosts[host] ?? "network";
    if (mode === "network") throw new TypeError("fetch failed");
    if (mode === "http500") return new Response("boom", { status: 500 });
    if (mode === "single") return Response.json(Array.isArray(body) ? { jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch not supported" } } : answer(chain, body));
    return Response.json(Array.isArray(body) ? calls.map((c) => answer(chain, c)) : answer(chain, body));
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = real; } };
}

const make = (urls = ["https://a.example", "https://b.example"]) => new AgtResolver({ rpcUrls: urls, registry: REGISTRY });

test("resolveAddresses: an active name costs two batched round trips and returns addr + agentWallet", async () => {
  const m = mockRpc({ active: true, addr: ADDR, wallet: WALLET }, { "a.example": "ok" });
  try {
    const r = await make().resolveAddresses("Launchpad.agt");
    assert.equal(r.name, "launchpad.agt");
    assert.equal(r.active, true);
    assert.equal(r.registered, true);
    assert.equal(r.resolver, RESOLVER);
    assert.equal(r.addr, ADDR);
    assert.equal(r.wallet, WALLET);
    assert.equal("coinType" in r, false);
    assert.deepEqual(m.seen, [{ host: "a.example", batch: 3 }, { host: "a.example", batch: 2 }]);
  } finally { m.restore(); }
});

test("resolveAddresses: a lapsed name stops after the registry round trip with null addresses", async () => {
  const m = mockRpc({ active: false, addr: ADDR, wallet: WALLET }, { "a.example": "ok" });
  try {
    const r = await make().resolveAddresses("lapsed.agt");
    assert.equal(r.active, false);
    assert.equal(r.registered, true);
    assert.equal(r.addr, null);
    assert.equal(r.wallet, null);
    assert.equal(m.seen.length, 1);
  } finally { m.restore(); }
});

test("resolveAddresses: the zero address is null, not 0x000…0", async () => {
  const m = mockRpc({ active: true, addr: null, wallet: null }, { "a.example": "ok" });
  try {
    const r = await make().resolveAddresses("empty.agt");
    assert.equal(r.addr, null);
    assert.equal(r.wallet, null);
  } finally { m.restore(); }
});

test("resolveAddresses: coinType adds one call to the second batch and decodes the bytes; empty bytes are null", async () => {
  const m = mockRpc({ active: true, addr: ADDR, wallet: null, coin: WALLET }, { "a.example": "ok" });
  try {
    const base = coinTypeForChain(8453);
    const r = await make().resolveAddresses("multichain.agt", { coinType: base });
    assert.equal(r.coinType, base.toString());
    assert.equal(r.coinTypeAddr, WALLET);
    assert.deepEqual(m.seen, [{ host: "a.example", batch: 3 }, { host: "a.example", batch: 3 }]);
  } finally { m.restore(); }
  const m2 = mockRpc({ active: true, addr: ADDR, wallet: null, coin: null }, { "a.example": "ok" });
  try {
    const r = await make().resolveAddresses("multichain.agt", { coinType: 60 });
    assert.equal(r.coinType, "60");
    assert.equal(r.coinTypeAddr, null);
    assert.equal(r.addr, ADDR);
  } finally { m2.restore(); }
});

test("resolveAddresses: transport failures fail over to the next endpoint (sticky within the instance); every endpoint down is one error", async () => {
  const m = mockRpc({ active: true, addr: ADDR, wallet: ADDR }, { "a.example": "network", "b.example": "http500", "c.example": "ok" });
  try {
    const agt = make(["https://a.example", "https://b.example", "https://c.example"]);
    const r = await agt.resolveAddresses("launchpad.agt");
    assert.equal(r.addr, ADDR);
    // first round trip walks a → b → c; the second goes straight to c (failed endpoints rotated to the back)
    assert.deepEqual(m.seen.map((s) => s.host), ["a.example", "b.example", "c.example", "c.example"]);
    assert.deepEqual(agt.cfg.rpcUrls, ["https://c.example", "https://a.example", "https://b.example"]);
    assert.equal(agt.cfg.rpcUrl, "https://a.example");
  } finally { m.restore(); }
  const m2 = mockRpc({ active: true, addr: ADDR, wallet: ADDR }, {});
  try {
    await assert.rejects(make().resolveAddresses("launchpad.agt"), /rpc failed on 2 endpoint\(s\): fetch failed/);
  } finally { m2.restore(); }
});

test("resolveAddresses: a reverting item is null without failing over; an endpoint that rejects batches falls back to single calls", async () => {
  const m = mockRpc({ active: true, addr: ADDR, wallet: ADDR, resolverReverts: true }, { "a.example": "ok" });
  try {
    // MVP-registry shape: resolverOf reverts → addrOf on the registry (which this fake does not implement → null), no failover to b.example
    const r = await make().resolveAddresses("mvp.agt");
    assert.equal(r.resolver, null);
    assert.equal(r.addr, null);
    assert.equal(m.seen.every((s) => s.host === "a.example"), true);
  } finally { m.restore(); }
  const m2 = mockRpc({ active: true, addr: ADDR, wallet: WALLET }, { "a.example": "single" });
  try {
    const r = await make(["https://a.example"]).resolveAddresses("launchpad.agt");
    assert.equal(r.addr, ADDR);
    assert.equal(r.wallet, WALLET);
    assert.equal(m2.seen.filter((s) => s.batch === 0).length, 5, "3 + 2 single calls after the two rejected batches");
  } finally { m2.restore(); }
});

test("resolveAddresses: a registry that errors on expiryOf/isActive throws instead of reporting an unregistered name", async () => {
  const m = mockRpc({ active: true, addr: ADDR, wallet: ADDR, registryReverts: true }, { "a.example": "ok" });
  try {
    await assert.rejects(make().resolveAddresses("launchpad.agt"), /registry 0x5B93.* did not answer for launchpad\.agt/);
    assert.equal(m.seen.length, 1, "an eth_call error is an answer: no failover to b.example");
  } finally { m.restore(); }
});

test("accountKind / isContract: eth_getCode tells a contract from a key-controlled account; an EIP-7702 delegation is still key-controlled", async () => {
  const DELEGATED = "0x37007a1c233f00b423bc0d177ac5b50ca9417596";
  const m = mockRpc({ active: true, addr: ADDR, wallet: ADDR, contracts: [WALLET], delegated: [DELEGATED] }, { "a.example": "ok" });
  try {
    assert.equal(await make().accountKind(WALLET), "contract");
    assert.equal(await make().accountKind(DELEGATED), "delegated-eoa");
    assert.equal(await make().accountKind("0x000000000000000000000000000000000000dEaD"), "eoa");
    assert.equal(await make().isContract(WALLET), true);
    assert.equal(await make().isContract(DELEGATED), false);
    m.seen.length = 0;
    assert.equal(await make().isContract(ADDR), false);
    assert.deepEqual(m.seen, [{ host: "a.example", batch: 0 }], "one eth_getCode, not a batch");
  } finally { m.restore(); }
});

test("constructor: rpcUrls precedence (explicit list > rpcUrl > chain list > chain url) and polygon ships a fallback list", () => {
  assert.deepEqual(new AgtResolver({ chain: "polygon" }).cfg.rpcUrls, ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org", "https://1rpc.io/matic"]);
  assert.deepEqual(new AgtResolver({ chain: "polygon", rpcUrl: "https://x.example" }).cfg.rpcUrls, ["https://x.example"]);
  assert.deepEqual(new AgtResolver({ chain: "polygon", rpcUrl: "https://x.example", rpcUrls: ["https://y.example", "https://z.example"] }).cfg.rpcUrls, ["https://y.example", "https://z.example"]);
  assert.equal(new AgtResolver({ chain: "polygon", rpcUrls: ["https://y.example"] }).cfg.rpcUrl, "https://y.example");
  assert.deepEqual(new AgtResolver({ chain: "amoy" }).cfg.rpcUrls, ["https://polygon-amoy-bor-rpc.publicnode.com"]);
});

test("abi: decBytes, coinTypeForChain (ENSIP-11), checksumAddress (EIP-55)", () => {
  assert.equal(decBytes(abiBytes(WALLET)), WALLET);
  assert.equal(decBytes(abiBytes("")), "");
  assert.equal(decBytes("0x"), "");
  assert.equal(coinTypeForChain(1), 60n);
  assert.equal(coinTypeForChain(137), 2147483785n);   // 0x80000000 | 137
  assert.equal(coinTypeForChain(8453), 2147492101n);  // 0x80000000 | 8453
  assert.equal(checksumAddress(ADDR), "0x37007A1C233F00b423BC0d177AC5B50CA9417596");
  assert.equal(checksumAddress("0x5b9386c47395b0551c814cc03b69cbd20eb0c87a"), REGISTRY);
  assert.throws(() => checksumAddress("0x123"));
});

test("data: manifest URIs decode without Buffer (base64 and percent-encoded)", async () => {
  const doc = JSON.stringify({ agt: "3.0", name: "inline.agt" });
  const b64 = btoa(doc);
  assert.equal(new TextDecoder().decode(await fetchManifestBytes(`data:application/json;base64,${b64}`)), doc);
  assert.equal(new TextDecoder().decode(await fetchManifestBytes(`data:application/json,${encodeURIComponent(doc)}`)), doc);
});
