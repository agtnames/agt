#!/usr/bin/env node
/**
 * agt-countersign — build, sign, describe and check session grants.
 *
 *   agt-countersign build --owner 0x… --session 0x… --names a,b --actions text,endpoint [--ttl 1h] [--calls 5]
 *                         [--chain 137|80002] [--rpc URL] [--sign-with-key ENV_VAR | --typed-data]
 *   agt-countersign sign  <grant.json> --signatures 0x…,0x…        attach wallet signatures (names order)
 *   agt-countersign describe <grant.json>                          offline: mandate + problems
 *   agt-countersign status   <grant.json> [--rpc URL]              on-chain: calls used, nonce, expiry
 *   agt-countersign revoke-all --owner-key ENV_VAR [--chain …]     owner bumps the NonceEnforcer nonce
 *
 * `build` reads the owner's current NonceEnforcer nonce from the chain. With --typed-data it prints the EIP-712
 * payloads to sign in a wallet (eth_signTypedData_v4), one per name; `sign` attaches the results.
 * Keys are only ever read from environment variables named on the command line, never from arguments.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon, polygonAmoy } from "viem/chains";
import { ACTION_IDS, isActionId, type ActionId } from "./actions.js";
import { attachSignatures, buildGrant, decodeGrant, delegationTypedData, describeGrant, encodeGrant, environmentFor, signGrantWithKey, type SupportedChainId } from "./grant.js";
import { DEFAULT_RPC, grantStatus } from "./redeem.js";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string) => args.includes(`--${name}`);
const die = (m: string, code = 2): never => { console.error(`agt-countersign: ${m}`); process.exit(code); };
const chainId = Number(flag("chain") ?? 137) as SupportedChainId;
const rpc = flag("rpc") ?? DEFAULT_RPC[chainId];
const chain = chainId === 137 ? polygon : polygonAmoy;
const ttl = (s: string): number => { const m = s.match(/^(\d+)\s*(s|m|h|d)?$/); if (!m) die(`bad --ttl ${s}`); return Number(m![1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[m![2] ?? "s"] as number); };
const keyFromEnv = (v: string | undefined): Hex => { if (!v) die("name the environment variable holding the key"); const k = process.env[v!]; if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) die(`${v} is not set to a 32-byte hex key`); return k as Hex; };
const nonceAbi = parseAbi(["function currentNonce(address delegationManager, address delegator) view returns (uint256)", "function incrementNonce(address delegationManager)"]);

async function main() {
  if (!cmd || has("help") || cmd === "-h") { const src = readFileSync(new URL(import.meta.url), "utf8"); console.log(src.slice(src.indexOf("/**") + 3, src.indexOf("*/")).replace(/^ \* ?/gm, "").trim()); return; }
  const env = environmentFor(chainId);
  const pub = createPublicClient({ chain, transport: http(rpc) });

  if (cmd === "build") {
    const owner = flag("owner") as Address | undefined; const session = flag("session") as Address | undefined;
    if (!owner || !session) die("--owner and --session are required");
    const names = (flag("names") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const actions = (flag("actions") ?? "text").split(",").map((s) => s.trim()).filter(Boolean);
    if (!actions.every(isActionId)) die(`--actions must be from: ${ACTION_IDS.join(", ")}`);
    const nonce = await pub.readContract({ address: env.caveatEnforcers.NonceEnforcer as Address, abi: nonceAbi, functionName: "currentNonce", args: [env.DelegationManager as Address, owner!] });
    let grant = buildGrant({ chainId, delegator: owner!, delegate: session!, names, actions: actions as ActionId[], ttlSeconds: ttl(flag("ttl") ?? "1h"), maxCalls: Number(flag("calls") ?? 5), nonce, resolver: flag("resolver") as Address | undefined });
    if (has("typed-data")) {
      console.log(JSON.stringify({ grant, typedData: grant.names.map((n) => ({ name: n.name, ...delegationTypedData(grant, n.delegation) })) }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
      return;
    }
    if (has("sign-with-key")) grant = await signGrantWithKey(grant, keyFromEnv(flag("sign-with-key")));
    const out = flag("out");
    const blob = encodeGrant(grant);
    if (out) { writeFileSync(out, blob); console.error(`wrote ${out} (${blob.length} bytes, hash ${grant.hash}${has("sign-with-key") ? ", signed" : ", UNSIGNED"})`); }
    else console.log(blob);
    return;
  }

  const file = args[1];
  if (!file) die("grant file required");
  const grant = decodeGrant(readFileSync(file, "utf8"));

  if (cmd === "sign") {
    const sigs = (flag("signatures") ?? "").split(",").map((s) => s.trim()).filter(Boolean) as Hex[];
    const signed = attachSignatures(grant, sigs);
    const d = await describeGrant(signed);
    if (!d.ok) die(`refusing to write a grant with problems: ${d.problems.join("; ")}`);
    writeFileSync(flag("out") ?? file, encodeGrant(signed));
    console.error(`signed grant written (${flag("out") ?? file})`);
    return;
  }
  if (cmd === "describe") {
    const d = await describeGrant(grant);
    console.log(d.summary.join("\n"));
    if (!d.ok) { console.log("\nPROBLEMS:\n- " + d.problems.join("\n- ")); process.exit(1); }
    console.log(`\nok · signed=${d.signed} · signaturesValid=${d.signaturesValid}`);
    return;
  }
  if (cmd === "status") {
    console.log(JSON.stringify(await grantStatus(grant, { rpcUrl: rpc }), null, 2));
    return;
  }
  if (cmd === "revoke-all") {
    const wallet = createWalletClient({ account: privateKeyToAccount(keyFromEnv(flag("owner-key"))), chain, transport: http(rpc) });
    const hash = await wallet.writeContract({ address: env.caveatEnforcers.NonceEnforcer as Address, abi: nonceAbi, functionName: "incrementNonce", args: [env.DelegationManager as Address] });
    console.log(`incrementNonce sent: ${hash}`);
    return;
  }
  die(`unknown command ${cmd}`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e), 1));
