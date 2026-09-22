/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { HOME_CHAIN, PROTOCOL, PROTOCOL_OWNER, SUPPORTED_CHAINS, chainNumber, entriesFrom, isSupportedChain, lookupDomain, normalizeDomain, type AddressRecords, type AddressSource } from "./resolve";
import manifest from "../snap.manifest.json";
import pkg from "../package.json";

const ADDR = "0x37007a1c233f00b423bc0d177ac5b50ca9417596";
const ADDR_CS = "0x37007A1C233F00b423BC0d177AC5B50CA9417596";
const WALLET = "0x7f4a455321af6cbbb8077d8e5245809958747566";
const WALLET_CS = "0x7F4a455321af6cBbB8077d8E5245809958747566";
const BASE_ADDR = "0x3db3000000000000000000000000000000000abc";
const BASE_ADDR_CS = "0x3DB3000000000000000000000000000000000ABc"; // EIP-55 of BASE_ADDR (same helper the resolver tests pin against known addresses)
const BASE = "eip155:8453";

const rec = (r: Partial<AddressRecords>): AddressRecords => ({ active: true, addr: null, wallet: null, coinTypeAddr: null, ...r });
const source = (r: AddressRecords, seen: Array<{ name: string; coinType: string }> = [], contracts: string[] = [], codeChecks: string[] = []): AddressSource => ({
  async resolveAddresses(name, opts) { seen.push({ name, coinType: opts.coinType.toString() }); return r; },
  async isContract(address) { codeChecks.push(address); return contracts.map((a) => a.toLowerCase()).includes(address.toLowerCase()); },
});

describe("normalizeDomain", () => {
  it("accepts label.agt in any case with a trailing dot", () => {
    expect(normalizeDomain(" Launchpad.agt. ")).toBe("launchpad.agt");
    expect(normalizeDomain("xn--bcher-kva.agt")).toBe("xn--bcher-kva.agt");
  });
  it("rejects anything that is not a single .agt label", () => {
    for (const bad of ["launchpad", "launchpad.eth", "a.b.agt", "-x.agt", "x-.agt", "foo bar.agt", ".agt", "x".repeat(64) + ".agt", "0x37007a1c233f00b423bc0d177ac5b50ca9417596"]) {
      expect(normalizeDomain(bad)).toBeNull();
    }
  });
});

describe("chains", () => {
  it("answers on the seven EVM chains and matches the manifest caveat exactly", () => {
    const caveat = (manifest.initialPermissions as Record<string, { chains?: string[] }>)["endowment:name-lookup"].chains;
    expect([...SUPPORTED_CHAINS]).toEqual(caveat);
    expect(SUPPORTED_CHAINS).toContain(HOME_CHAIN);
    expect(isSupportedChain("eip155:137")).toBe(true);
    expect(isSupportedChain("eip155:11155111")).toBe(false);
    expect(isSupportedChain("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBe(false);
    expect(chainNumber("eip155:8453")).toBe(8453);
    expect(chainNumber("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBeNull();
  });
  it("keeps package.json and snap.manifest.json in lockstep (version, package name, permissions)", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.source.location.npm.packageName).toBe(pkg.name);
    expect(Object.keys(manifest.initialPermissions).sort()).toEqual(["endowment:name-lookup", "endowment:network-access"]);
  });
});

describe("entriesFrom (D-028 v2)", () => {
  it("one entry when the payment wallet equals addr (the common case today)", () => {
    expect(entriesFrom("launchpad.agt", HOME_CHAIN, rec({ addr: ADDR, wallet: ADDR }))).toEqual([
      { resolvedAddress: ADDR_CS, protocol: PROTOCOL, domainName: "launchpad.agt" },
    ]);
  });
  it("on Polygon: the typed payment wallet leads, the owner account follows when different", () => {
    expect(entriesFrom("x.agt", HOME_CHAIN, rec({ addr: ADDR, wallet: WALLET }))).toEqual([
      { resolvedAddress: WALLET_CS, protocol: PROTOCOL, domainName: "x.agt" },
      { resolvedAddress: ADDR_CS, protocol: PROTOCOL_OWNER, domainName: "x.agt" },
    ]);
  });
  it("on Polygon: addr alone (plain label) when no payment wallet is set; wallet alone when addr is unset", () => {
    expect(entriesFrom("x.agt", HOME_CHAIN, rec({ addr: ADDR }))).toEqual([{ resolvedAddress: ADDR_CS, protocol: PROTOCOL, domainName: "x.agt" }]);
    expect(entriesFrom("x.agt", HOME_CHAIN, rec({ wallet: WALLET }))).toEqual([{ resolvedAddress: WALLET_CS, protocol: PROTOCOL, domainName: "x.agt" }]);
  });
  it("off Polygon: the payment wallet is never offered (it is a Polygon payment address)", () => {
    expect(entriesFrom("x.agt", BASE, rec({ addr: ADDR, wallet: WALLET }))).toEqual([{ resolvedAddress: ADDR_CS, protocol: PROTOCOL, domainName: "x.agt" }]);
    expect(entriesFrom("x.agt", "eip155:1", rec({ wallet: WALLET }))).toEqual([]);
  });
  it("a per-chain addr(coinType) record replaces addr on that chain (ENSIP-11), on Polygon too", () => {
    expect(entriesFrom("x.agt", BASE, rec({ addr: ADDR, wallet: ADDR, coinTypeAddr: BASE_ADDR }))).toEqual([
      { resolvedAddress: BASE_ADDR_CS, protocol: PROTOCOL, domainName: "x.agt" },
    ]);
    expect(entriesFrom("x.agt", HOME_CHAIN, rec({ addr: ADDR, wallet: WALLET, coinTypeAddr: BASE_ADDR }))).toEqual([
      { resolvedAddress: WALLET_CS, protocol: PROTOCOL, domainName: "x.agt" },
      { resolvedAddress: BASE_ADDR_CS, protocol: PROTOCOL_OWNER, domainName: "x.agt" },
    ]);
    // a non-20-byte coinType record (not an EVM address) is ignored
    expect(entriesFrom("x.agt", BASE, rec({ addr: ADDR, coinTypeAddr: "0x0102" }))).toEqual([{ resolvedAddress: ADDR_CS, protocol: PROTOCOL, domainName: "x.agt" }]);
  });
  it("nothing for inactive names or names without records", () => {
    expect(entriesFrom("x.agt", HOME_CHAIN, rec({ active: false, addr: ADDR, wallet: WALLET }))).toEqual([]);
    expect(entriesFrom("x.agt", HOME_CHAIN, rec({}))).toEqual([]);
  });
});

describe("lookupDomain", () => {
  it("resolves a supported chain + valid name through the source, asking for that chain's coin type", async () => {
    const seen: Array<{ name: string; coinType: string }> = [];
    await expect(lookupDomain("Launchpad.agt", BASE, source(rec({ addr: ADDR, wallet: ADDR }), seen))).resolves.toEqual({
      resolvedAddresses: [{ resolvedAddress: ADDR_CS, protocol: PROTOCOL, domainName: "launchpad.agt" }],
    });
    expect(seen).toEqual([{ name: "launchpad.agt", coinType: "2147492101" }]); // 0x80000000 | 8453
    seen.length = 0;
    await lookupDomain("launchpad.agt", "eip155:1", source(rec({ addr: ADDR }), seen));
    expect(seen[0].coinType).toBe("60");
  });
  it("returns null without touching the source for an unsupported chain or a non-.agt domain", async () => {
    const seen: Array<{ name: string; coinType: string }> = [];
    const s = source(rec({ addr: ADDR, wallet: ADDR }), seen);
    await expect(lookupDomain("launchpad.agt", "eip155:11155111", s)).resolves.toBeNull();
    await expect(lookupDomain("vitalik.eth", "eip155:1", s)).resolves.toBeNull();
    expect(seen).toEqual([]);
  });
  it("returns null for lapsed names, empty records and RPC failure", async () => {
    await expect(lookupDomain("lapsed.agt", HOME_CHAIN, source(rec({ active: false, addr: ADDR, wallet: ADDR })))).resolves.toBeNull();
    await expect(lookupDomain("empty.agt", HOME_CHAIN, source(rec({})))).resolves.toBeNull();
    const down: AddressSource = { async resolveAddresses() { throw new Error("rpc failed on 3 endpoint(s)"); }, async isContract() { return false; } };
    await expect(lookupDomain("launchpad.agt", HOME_CHAIN, down)).resolves.toBeNull();
  });
  it("off Polygon, a contract account (Safe / 4337) is not reused; a key-controlled account (EOA or 7702-delegated) is; a per-chain record skips the check", async () => {
    const checks: string[] = [];
    // Safe on Polygon → nothing on Base
    await expect(lookupDomain("treasury.agt", BASE, source(rec({ addr: ADDR, wallet: ADDR }), [], [ADDR], checks))).resolves.toBeNull();
    expect(checks).toEqual([ADDR]);
    // ... but still resolves on Polygon itself, without a code check
    checks.length = 0;
    await expect(lookupDomain("treasury.agt", HOME_CHAIN, source(rec({ addr: ADDR, wallet: ADDR }), [], [ADDR], checks))).resolves.toEqual({
      resolvedAddresses: [{ resolvedAddress: ADDR_CS, protocol: PROTOCOL, domainName: "treasury.agt" }],
    });
    expect(checks).toEqual([]);
    // EOA on Polygon → reused on Base
    await expect(lookupDomain("launchpad.agt", BASE, source(rec({ addr: ADDR, wallet: ADDR }), [], [], checks))).resolves.toEqual({
      resolvedAddresses: [{ resolvedAddress: ADDR_CS, protocol: PROTOCOL, domainName: "launchpad.agt" }],
    });
    // explicit Base record → no code check, even for a Safe
    checks.length = 0;
    await expect(lookupDomain("treasury.agt", BASE, source(rec({ addr: ADDR, coinTypeAddr: BASE_ADDR }), [], [ADDR], checks))).resolves.toEqual({
      resolvedAddresses: [{ resolvedAddress: BASE_ADDR_CS, protocol: PROTOCOL, domainName: "treasury.agt" }],
    });
    expect(checks).toEqual([]);
    // code check failing → nothing (no guess)
    const flaky: AddressSource = { async resolveAddresses() { return rec({ addr: ADDR }); }, async isContract() { throw new Error("rpc failed"); } };
    await expect(lookupDomain("launchpad.agt", BASE, flaky)).resolves.toBeNull();
  });
});
