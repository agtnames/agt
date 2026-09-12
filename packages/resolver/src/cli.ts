#!/usr/bin/env node
/**
 * agt-resolve — CLI over @agtnames/resolver.
 *   agt-resolve resolve   exampleagent.agt [--chain polygon|amoy|localhost] [--rpc URL] [--registry 0x…] [--legacy]
 *   agt-resolve record    exampleagent.agt …          on-chain record only (owner, expiry, resolver, records)
 *   agt-resolve available foo.agt …
 *   agt-resolve text      exampleagent.agt "url" …
 *   agt-resolve fns       exampleagent.agt …          Registry v1 (Freename) owner on Polygon
 *   agt-resolve namehash  exampleagent.agt             no network
 * Env fallbacks: AGT_CHAIN, AGT_RPC_URL, AGT_REGISTRY, AGT_FNS, AGT_IPFS_GATEWAY, AGT_DOH_URL
 * --legacy enables the FNS.ownerOf and DNS TXT fallbacks.
 */
import { AgtResolver, namehash, normalizeName, tokenIdOf } from "./index.js";

const argv = process.argv.slice(2);
const flags: Record<string, string> = {};
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--legacy") flags.legacy = "1";
  else if (argv[i].startsWith("--")) { flags[argv[i].slice(2)] = argv[i + 1] ?? ""; i++; }
  else pos.push(argv[i]);
}
const [cmd, name, arg] = pos;

async function main() {
  if (!cmd || !name) {
    console.error("usage: agt-resolve <resolve|record|available|text|fns|namehash> <name> [key] [--chain X] [--rpc URL] [--registry 0x…] [--legacy]");
    process.exit(2);
  }
  if (cmd === "namehash") {
    const n = normalizeName(name);
    console.log(JSON.stringify({ name: n, node: namehash(n), tokenId: tokenIdOf(n).toString() }, null, 2));
    return;
  }
  const r = new AgtResolver({
    chain: flags.chain ?? process.env.AGT_CHAIN,
    rpcUrl: flags.rpc ?? process.env.AGT_RPC_URL,
    registry: flags.registry ?? process.env.AGT_REGISTRY,
    fns: flags.fns ?? process.env.AGT_FNS,
    ipfsGateway: flags.gateway ?? process.env.AGT_IPFS_GATEWAY,
    dohUrl: flags.doh ?? process.env.AGT_DOH_URL,
    legacyFns: flags.legacy === "1",
    legacyDns: flags.legacy === "1",
  });
  const out =
    cmd === "resolve" ? await r.resolveAgent(name)
    : cmd === "record" ? await r.resolve(name)
    : cmd === "available" ? { name: normalizeName(name), available: await r.available(name) }
    : cmd === "text" ? { name: normalizeName(name), key: arg, value: await r.text(name, arg ?? "") }
    : cmd === "fns" ? { name: normalizeName(name), fnsOwner: await r.fnsOwner(name) }
    : null;
  if (!out) { console.error(`unknown command ${cmd}`); process.exit(2); }
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
