#!/usr/bin/env node
/**
 * agt — register a .agt name, publish its signed manifest, set its records and verify it, from a terminal.
 *
 *   agt available <name>
 *   agt register <name> [--years N] [--to 0x…] [--dry-run] [--yes]
 *   agt manifest init [name] [--out file.json] [--no-probe] [--shell bash|powershell] [--template]
 *   agt manifest publish <name> <file.json> [--host agts.dev|ipfs] [--no-records] [--skip-live-check] [--dry-run]
 *   agt records set <name> [--mcp URL] [--a2a URL] [--http URL] [--ws URL] [--wallet 0x…] [--addr 0x…] [--manifest URI] [--dry-run]
 *   agt verify <name> [--no-endpoints] [--json]
 *   agt keyfile create <file>        encrypt a private key into a keyfile (prompts for the key and a passphrase)
 *   agt keyfile address <file>       print the keyfile's address (no passphrase needed)
 *
 * Signing (writes only):
 *   default                  opens a local page; approve each request in MetaMask (the key never leaves the wallet)
 *   --signer key             key from AGT_OWNER_KEY, or from the variable --key-env names
 *   --keyfile <file>         key from an encrypted keyfile; passphrase from AGT_KEYFILE_PASSPHRASE or a prompt
 *   --no-open                print the wallet page URL instead of opening a browser
 *
 * Network: --network polygon|amoy (AGT_NETWORK, default polygon), --rpc URL (AGT_RPC_URL), --site URL (AGT_SITE,
 * default https://agtnames.com; required on amoy). --dry-run on any write signs what needs signing, prints the exact
 * document and transactions, and sends nothing. --json prints the result as JSON on stdout.
 *
 * Exit codes: 0 done, 1 failed (or verify found problems), 2 usage error.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Address } from "viem";
import { parseAddressFlag, parseArgs, parseHttpsFlag, parseYears, UsageError, type Parsed } from "./args.js";
import { browserSigner } from "./browser.js";
import { resolverAbi } from "./abi.js";
import { assertOwner, describePlan, dryTx, multicallTx, nameState, nodeOf, normalizeLabel, publicClient, recordCalls, sendAndWait, type RecordsPlan } from "./chain.js";
import { networkFrom, requireSite, type Network } from "./config.js";
import { decryptKey, encryptKey, readKeyfile, writeKeyfile } from "./keyfile.js";
import { buildManifest, hostManifest, lintInput, MANIFEST_TEMPLATE, signManifestWith, type ManifestInput } from "./manifest.js";
import { detectShell, interactiveInit } from "./init.js";
import { confirm, promptHidden } from "./prompt.js";
import { CancelledError, isInteractive } from "./tui.js";
import { checkQuote, fetchQuote, planRegister, usdc } from "./register.js";
import { keySigner, parsePrivateKey, type Signer } from "./signer.js";
import { checkEndpoint, verifyName, type VerifyReport } from "./verify.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;

interface Ctx { args: Parsed; net: Network; json: boolean; dry: boolean; log: (s: string) => void; out: (v: unknown, human: string[]) => void }

function help(): string {
  const src = readFileSync(new URL(import.meta.url), "utf8");
  return src.slice(src.indexOf("/**") + 3, src.indexOf("*/")).replace(/^ \* ?/gm, "").trim();
}

async function signerFor(c: Ctx): Promise<Signer> {
  const f = c.args.flags;
  const kind = f.keyfile ? "keyfile" : f["key-env"] ? "key" : (f.signer ?? "browser");
  if (kind === "key") {
    const v = f["key-env"] ?? "AGT_OWNER_KEY";
    return keySigner(parsePrivateKey(process.env[v], v), c.net);
  }
  if (kind === "keyfile") {
    if (!f.keyfile) throw new UsageError("--signer keyfile needs --keyfile <file>");
    const e = readKeyfile(f.keyfile);
    const pass = process.env.AGT_KEYFILE_PASSPHRASE ?? await promptHidden(`Passphrase for ${f.keyfile} (${e.address}): `);
    const s = keySigner(decryptKey(e, pass), c.net, "keyfile");
    if (s.address.toLowerCase() !== e.address.toLowerCase()) throw new Error("the keyfile's stored address does not match its key; the file was edited");
    return s;
  }
  if (kind !== "browser") throw new UsageError("--signer must be browser, key or keyfile");
  const noOpen = c.args.bools.has("no-open");
  const timeout = f.timeout ? Number(f.timeout) * 60_000 : undefined;
  c.log(`Opening the wallet page${noOpen ? "" : " in your browser"}. Keep it open until the command finishes.`);
  const s = await browserSigner({ network: c.net, timeoutMs: timeout, open: noOpen ? () => {} : undefined, onUrl: (u) => c.log(`  ${u}`) });
  c.log(`Connected: ${s.address}`);
  return s;
}

async function withSigner<T>(c: Ctx, fn: (s: Signer) => Promise<T>): Promise<T> {
  const s = await signerFor(c);
  try { return await fn(s); } finally { await s.close(); }
}

const labelArg = (c: Ctx, i: number, what = "name") => {
  const v = c.args.positionals[i];
  if (!v) throw new UsageError(`missing <${what}>`);
  return normalizeLabel(v);
};

// ── available ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function available(c: Ctx) {
  const label = labelArg(c, 1);
  const site = requireSite(c.net);
  const r = await fetch(`${site}/api/search?name=${encodeURIComponent(label)}`);
  const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string; available?: boolean; reserved?: boolean; status?: string; tier?: string; registerUsd?: number; renewUsd?: number; registrationOpen?: boolean };
  if (!r.ok || !j.success) throw new Error(`lookup failed (${r.status}): ${j.error ?? "no reason given"}`);
  const human = j.available
    ? [`${label}.agt is available: $${j.registerUsd} for the first year, $${j.renewUsd}/year after.`, `Register it with: agt register ${label}`]
    : [`${label}.agt is not available (${j.reserved ? "reserved" : j.status ?? "taken"}).`];
  if (j.available && j.registrationOpen === false) human.push("Registration is not open yet.");
  c.out({ name: `${label}.agt`, available: !!j.available, status: j.status, tier: j.tier, registerUsd: j.registerUsd, renewUsd: j.renewUsd, registrationOpen: j.registrationOpen }, human);
}

// ── register ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function register(c: Ctx) {
  const label = labelArg(c, 1);
  const years = parseYears(c.args.flags.years);
  const toFlag = parseAddressFlag(c.args.flags.to, "to");
  const site = requireSite(c.net);
  const pc = publicClient(c.net);
  await withSigner(c, async (s) => {
    const to = (toFlag ?? s.address) as Address;
    const gift = to.toLowerCase() !== s.address.toLowerCase();
    c.log(`Getting a quote for ${label}.agt (${years} year${years === 1 ? "" : "s"})…`);
    const q = await fetchQuote(site, { label, to, years, payToken: "usdc" });
    const quote = checkQuote(q, { label, to }, c.net);
    const plan = await planRegister(pc, c.net, q, quote, s.address);
    const mins = Math.max(0, Math.floor((Number(quote.validUntil) - Date.now() / 1000) / 60));
    c.log(`Price ${usdc(quote.price)}. Your USDC balance: ${usdc(plan.balance)}. The quote is good for about ${mins} minutes.`);
    if (gift) c.log(`Note: ${label}.agt will be owned by ${to}, not you. Only that wallet can publish its manifest or set its records.`);
    if (c.dry) {
      c.out({ dryRun: true, quote: q, transactions: plan.txs.map((t) => dryTx(t, s.address)) }, ["Dry run: nothing sent. Transactions:", ...plan.txs.map((t) => `  ${t.description}`)]);
      return;
    }
    if (plan.balance < quote.price) throw new Error(`not enough USDC: need ${usdc(quote.price)}, have ${usdc(plan.balance)} (USDC on ${c.net.chain.name}, ${c.net.usdc})`);
    const gas = await pc.getBalance({ address: s.address });
    if (gas === 0n) throw new Error(`${s.address} has no ${c.net.chain.nativeCurrency.symbol} for gas`);
    if (s.kind !== "browser" && !c.args.bools.has("yes") && !(await confirm(`Send ${plan.txs.length} transaction${plan.txs.length === 1 ? "" : "s"} from ${s.address}?`))) throw new Error("cancelled");
    const hashes = [];
    for (const tx of plan.txs) hashes.push(await sendAndWait(pc, c.net, s, tx, c.log));
    const after = await nameState(pc, c.net, label);
    if (after.owner?.toLowerCase() !== to.toLowerCase()) throw new Error(`registered, but ${label}.agt reads as owned by ${after.owner ?? "nobody"}; check ${hashes.at(-1)}`);
    c.out({ name: `${label}.agt`, owner: after.owner, transactions: hashes }, [
      `✓ ${label}.agt is registered to ${after.owner}.`,
      ...(gift ? [] : [`Next: agt manifest init ${label}   then   agt manifest publish ${label} ${label}.manifest.json`]),
    ]);
  });
}

// ── manifest init / publish ───────────────────────────────────────────────────────────────────────────────────────
async function manifestInit(c: Ctx) {
  const interactive = isInteractive() && !c.args.bools.has("template") && !c.json;
  if (interactive) {
    const shell = c.args.flags.shell ?? detectShell();
    if (shell !== "bash" && shell !== "powershell") throw new UsageError("--shell must be bash or powershell");
    const v = c.args.positionals[2];
    await interactiveInit({ label: v, out: c.args.flags.out, network: c.net, probe: !c.args.bools.has("no-probe"), shell, log: c.log });
    return;
  }
  const label = labelArg(c, 2);
  const file = c.args.flags.out ?? `${label}.manifest.json`;
  if (existsSync(file)) throw new Error(`${file} already exists`);
  writeFileSync(file, JSON.stringify(MANIFEST_TEMPLATE, null, 2) + "\n");
  c.out({ file }, [`Wrote ${file}. Fill in the description and endpoints, then run:`, `  agt manifest publish ${label} ${file}`]);
}

async function manifestPublish(c: Ctx) {
  const label = labelArg(c, 2);
  const file = c.args.positionals[3];
  if (!file) throw new UsageError("missing <file.json> (create one with `agt manifest init`)");
  const host = (c.args.flags.host ?? "agts.dev") as "agts.dev" | "ipfs";
  if (host !== "agts.dev" && host !== "ipfs") throw new UsageError("--host must be agts.dev or ipfs");
  let input: ManifestInput;
  try { input = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new Error(`could not read ${file}: ${(e as Error).message}`); }
  const problems = lintInput(input);
  if (problems.length) throw new Error(`fix ${file} first:\n  - ${problems.join("\n  - ")}`);
  const site = requireSite(c.net);
  const pc = publicClient(c.net);

  if (!c.args.bools.has("skip-live-check")) {
    const checks = await Promise.all((input.endpoints ?? []).map((e) => checkEndpoint(e.protocol, e.url)));
    const dead = checks.filter((x) => !x.live);
    if (dead.length) throw new Error(`these endpoints are not reachable yet, so the manifest would point at nothing:\n  - ${dead.map((d) => `${d.protocol} ${d.url} (${d.error})`).join("\n  - ")}\nDeploy them first, or pass --skip-live-check to publish anyway.`);
  }

  await withSigner(c, async (s) => {
    const state = await nameState(pc, c.net, label);
    const resolver = assertOwner(state, s.address);
    const signed = await signManifestWith(s, buildManifest(label, s.address, input));
    const wallet = (signed.payments ?? []).find((p) => p.address)?.address as Address | undefined;
    const plan: RecordsPlan = { endpoints: (signed.endpoints ?? []).map((e) => ({ protocol: e.protocol, url: e.url })), addr: s.address, wallet };
    const current = await pc.readContract({ address: resolver, abi: resolverAbi, functionName: "agentManifest", args: [nodeOf(label)] }).catch(() => "");

    if (c.dry) {
      const predicted = host === "agts.dev" ? `https://agts.dev/${label}.json` : "(the ipfs:// URI returned by hosting)";
      const calls = recordCalls(label, { ...plan, manifest: host === "agts.dev" ? predicted : undefined }, current);
      c.out({ dryRun: true, manifest: signed, host, records: c.args.bools.has("no-records") ? null : dryTx(multicallTx(resolver, calls, "set records"), s.address) },
        ["Dry run: signed, nothing hosted or sent.", JSON.stringify(signed, null, 2), ...(c.args.bools.has("no-records") ? [] : describePlan(label, { ...plan, manifest: predicted }, current))]);
      return;
    }
    const pin = await hostManifest(site, signed, host);
    c.log(`Hosted (${pin.provider}): ${pin.uri}`);
    if (!c.args.bools.has("no-records")) {
      const full = { ...plan, manifest: pin.uri };
      describePlan(label, full, current).forEach((l) => c.log(l));
      await sendAndWait(pc, c.net, s, multicallTx(resolver, recordCalls(label, full, current), `Set ${label}.agt records (manifest, endpoints, addr${wallet ? ", wallet" : ""})`), c.log);
    }
    const report = await verifyName(c.net, label);
    c.out({ name: `${label}.agt`, uri: pin.uri, verify: report }, verifyLines(report));
    if (!report.ok) process.exitCode = 1;
  });
}

// ── records set ───────────────────────────────────────────────────────────────────────────────────────────────────
async function recordsSet(c: Ctx) {
  const label = labelArg(c, 2);
  const f = c.args.flags;
  const endpoints = (["mcp", "a2a", "http", "ws"] as const).flatMap((p) => { const u = parseHttpsFlag(f[p], p); return u ? [{ protocol: p, url: u }] : []; });
  const plan: RecordsPlan = { endpoints, wallet: parseAddressFlag(f.wallet, "wallet"), addr: parseAddressFlag(f.addr, "addr"), manifest: f.manifest };
  if (plan.manifest && !/^(https|ipfs):\/\//.test(plan.manifest)) throw new UsageError("--manifest must be an https:// or ipfs:// URI");
  if (!endpoints.length && !plan.wallet && !plan.addr && !plan.manifest) throw new UsageError("nothing to set: pass --mcp, --a2a, --http, --ws, --wallet, --addr or --manifest");
  const pc = publicClient(c.net);
  await withSigner(c, async (s) => {
    const resolver = assertOwner(await nameState(pc, c.net, label), s.address);
    const current = plan.manifest ? await pc.readContract({ address: resolver, abi: resolverAbi, functionName: "agentManifest", args: [nodeOf(label)] }).catch(() => "") : "";
    const calls = recordCalls(label, plan, current);
    const tx = multicallTx(resolver, calls, `Set ${calls.length} record${calls.length === 1 ? "" : "s"} on ${label}.agt`);
    const lines = describePlan(label, plan, current);
    if (c.dry) { c.out({ dryRun: true, transaction: dryTx(tx, s.address) }, ["Dry run: nothing sent.", ...lines]); return; }
    if (!calls.length) { c.out({ name: `${label}.agt`, changed: 0 }, ["Nothing to change."]); return; }
    lines.forEach((l) => c.log(l));
    const hash = await sendAndWait(pc, c.net, s, tx, c.log);
    c.out({ name: `${label}.agt`, transaction: hash }, [`✓ ${calls.length} record${calls.length === 1 ? "" : "s"} set on ${label}.agt. Check it with: agt verify ${label}`]);
  });
}

// ── verify ────────────────────────────────────────────────────────────────────────────────────────────────────────
function verifyLines(r: VerifyReport): string[] {
  return [
    `${r.ok ? "✓" : "✗"} ${r.name}: manifest ${r.manifestStatus}${r.owner ? `, owner ${r.owner}` : ""}${r.signer ? `, signed by ${r.signer}` : ""}`,
    ...(r.manifestUri ? [`  manifest ${r.manifestUri}`] : []),
    ...r.endpoints.map((e) => `  ${e.live ? "live" : "DOWN"}  ${e.protocol} ${e.url}${e.live ? ` (${e.via} ${e.status})` : ` (${e.error})`}`),
    ...r.problems.map((p) => `  problem: ${p}`),
  ];
}

async function verify(c: Ctx) {
  const label = labelArg(c, 1);
  const r = await verifyName(c.net, label, { skipEndpoints: c.args.bools.has("no-endpoints") });
  c.out(r, verifyLines(r));
  if (!r.ok) process.exitCode = 1;
}

// ── keyfile ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function keyfile(c: Ctx) {
  const sub = c.args.positionals[1];
  const file = c.args.positionals[2];
  if (!file) throw new UsageError(`missing <file>`);
  if (sub === "address") { const e = readKeyfile(file); c.out({ file, address: e.address }, [e.address]); return; }
  if (sub !== "create") throw new UsageError("keyfile commands: create, address");
  if (existsSync(file)) throw new Error(`${file} already exists`);
  const pk = parsePrivateKey(await promptHidden("Private key (0x…, hidden): "), "the key you entered");
  const pass = process.env.AGT_KEYFILE_PASSPHRASE ?? await promptHidden("New passphrase (12+ characters, hidden): ");
  if (!process.env.AGT_KEYFILE_PASSPHRASE && (await promptHidden("Repeat the passphrase: ")) !== pass) throw new Error("the passphrases do not match");
  const e = encryptKey(pk, pass);
  if (decryptKey(e, pass) !== pk.toLowerCase()) throw new Error("round-trip check failed; nothing written");
  writeKeyfile(file, e);
  c.out({ file, address: e.address }, [`Wrote ${file} for ${e.address}. Use it with --keyfile ${file}.`]);
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.bools.has("version")) { console.log(VERSION); return; }
  const [cmd, sub] = args.positionals;
  if (!cmd || args.bools.has("help") || cmd === "help") { console.log(help()); return; }
  const json = args.bools.has("json");
  const log = (s: string) => (json ? console.error(s) : console.log(s));
  const out = (v: unknown, human: string[]) => { if (json) console.log(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)); else human.forEach((l) => console.log(l)); };
  const c: Ctx = { args, net: networkFrom(args.flags), json, dry: args.bools.has("dry-run"), log, out };

  if (cmd === "available") return available(c);
  if (cmd === "register") return register(c);
  if (cmd === "verify") return verify(c);
  if (cmd === "keyfile") return keyfile(c);
  if (cmd === "manifest" && sub === "init") return manifestInit(c);
  if (cmd === "manifest" && sub === "publish") return manifestPublish(c);
  if (cmd === "records" && sub === "set") return recordsSet(c);
  throw new UsageError(`unknown command: ${args.positionals.slice(0, 2).join(" ")} (run agt --help)`);
}

main().catch((e) => {
  if (e instanceof CancelledError) { console.error("Stopped. Your answers so far are saved; run the same command to resume."); process.exit(130); }
  const usage = e instanceof UsageError;
  console.error(`agt: ${e instanceof Error ? e.message : String(e)}${usage ? "\nRun agt --help for usage." : ""}`);
  process.exit(usage ? 2 : 1);
});
