#!/usr/bin/env node
/**
 * agt-resolve — tiny CLI over @agt/resolver.
 *   agt-resolve resolve exampleagent.agt --rpc http://127.0.0.1:8545 --registry 0x…
 *   agt-resolve available foo.agt …
 *   agt-resolve text exampleagent.agt "agent-endpoint[mcp]" …
 *   agt-resolve namehash exampleagent.agt
 * Env fallbacks: AGT_RPC_URL, AGT_REGISTRY, AGT_IPFS_GATEWAY
 */
import { AgtResolver, namehash, normalizeName, tokenIdOf } from "./index.js";

const argv = process.argv.slice(2);
const flags: Record<string, string> = {};
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1] ?? "", i++;
  else pos.push(argv[i]);
}
const [cmd, name, arg] = pos;
const rpcUrl = flags.rpc ?? process.env.AGT_RPC_URL ?? "";
const registry = flags.registry ?? process.env.AGT_REGISTRY ?? "";
const ipfsGateway = flags.gateway ?? process.env.AGT_IPFS_GATEWAY;

async function main() {
  if (!cmd || !name) {
    console.error("usage: agt-resolve <resolve|record|available|text|namehash> <name> [key] [--rpc URL] [--registry 0x…]");
    process.exit(2);
  }
  if (cmd === "namehash") {
    const n = normalizeName(name);
    console.log(JSON.stringify({ name: n, node: namehash(n), tokenId: tokenIdOf(n).toString() }, null, 2));
    return;
  }
  const r = new AgtResolver({ rpcUrl, registry, ipfsGateway });
  const out =
    cmd === "resolve" ? await r.resolveAgent(name)
    : cmd === "record" ? await r.resolve(name)
    : cmd === "available" ? { name: normalizeName(name), available: await r.available(name) }
    : cmd === "text" ? { name: normalizeName(name), key: arg, value: await r.text(name, arg ?? "") }
    : null;
  if (!out) { console.error(`unknown command ${cmd}`); process.exit(2); }
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
