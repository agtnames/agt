/**
 * Interactive `agt manifest init`. Each step prefills from data the CLI actually has (RATIONALE R-5): the name's
 * current manifest, the agent's own MCP tools or A2A card (R-3), the top-ranked capability. Background work starts
 * as early as possible: the current manifest and the capability vocabulary load while the first questions are
 * answered, and each endpoint is read the moment its URL is entered. Answers are saved as a draft after every step,
 * so Ctrl+C loses nothing and the next run resumes (R-6).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { AgtResolver, CAPABILITY_VOCABULARY, suggestCapabilities, type AgtManifest, type CapabilityVocabulary } from "@agtnames/resolver";
import { normalizeLabel } from "./chain.js";
import type { Network } from "./config.js";
import type { ManifestInput } from "./manifest.js";
import { CapabilityPicker, type CapabilitySource, type CapabilitySuggestion } from "./picker.js";
import { probe, type SelfDescription } from "./probe.js";
import { BACK, CancelledError, copyToClipboard, eraseLines, run, SKIP, style } from "./tui.js";
import { EndpointsInput } from "./endpoints.js";
import { Select, TextInput } from "./widgets.js";

export interface InitAnswers {
  protocols?: string[];
  endpoints?: Record<string, string>;
  description?: string;
  website?: string;
  capabilities?: string[];
  pricing?: string;
  paid?: { currency: string; amount: string; unit: string };
  freeTier?: string;
  payment?: { rail: string; address: string } | null;
}

interface Draft { label: string; savedAt: string; answers: InitAnswers }

export type ShellKind = "powershell" | "bash";

export function detectShell(env: NodeJS.ProcessEnv = process.env, platform = process.platform): ShellKind {
  if (env.SHELL && /bash|zsh|sh$/.test(env.SHELL)) return "bash";
  return platform === "win32" ? "powershell" : "bash";
}

/** Quote one argument for the shell, only when it needs it. */
export function shellQuote(arg: string, shell: ShellKind): string {
  if (/^[A-Za-z0-9_./:\\=@-]+$/.test(arg)) return arg;
  return shell === "powershell" ? `'${arg.replace(/'/g, "''")}'` : `'${arg.replace(/'/g, `'\\''`)}'`;
}

const PROTOCOLS = [
  { value: "mcp", label: "MCP", description: "Model Context Protocol server (tools for AI clients)" },
  { value: "a2a", label: "A2A", description: "Agent-to-Agent endpoint with an agent card" },
  { value: "http", label: "HTTP", description: "Plain HTTP API" },
  { value: "ws", label: "WebSocket", description: "Streaming endpoint (wss://)" },
];

const httpsUrl = (protocol: string) => (v: string): string | null => {
  let u: URL;
  try { u = new URL(v); } catch { return "Enter a full URL starting with https://"; }
  if (u.protocol !== "https:" && !(protocol === "ws" && u.protocol === "wss:")) return protocol === "ws" ? "Use wss:// or https://" : "Use https://";
  return null;
};

// ── drafts ────────────────────────────────────────────────────────────────────────────────────────────────────────
const draftDir = () => process.env.AGT_DRAFT_DIR ?? join(homedir(), ".agt", "drafts");
const draftPath = (label: string) => join(draftDir(), `${label}.json`);

export function loadDraft(label: string): Draft | null {
  try { return JSON.parse(readFileSync(draftPath(label), "utf8")) as Draft; } catch { return null; }
}
export function saveDraft(label: string, answers: InitAnswers): void {
  mkdirSync(draftDir(), { recursive: true });
  writeFileSync(draftPath(label), JSON.stringify({ label, savedAt: new Date().toISOString(), answers }, null, 2) + "\n", { mode: 0o600 });
}
export function clearDraft(label: string): void { rmSync(draftPath(label), { force: true }); }

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

// ── manifest file from answers ────────────────────────────────────────────────────────────────────────────────────
export function answersToInput(a: InitAnswers): ManifestInput {
  const pricing = a.pricing ? { model: a.pricing, ...(a.paid && (a.pricing === "paid" || a.pricing === "freemium") ? { paid: a.paid } : {}), ...(a.freeTier && a.pricing === "freemium" ? { free_tier: a.freeTier } : {}) } : undefined;
  return {
    description: a.description,
    website: a.website || undefined,
    endpoints: (a.protocols ?? []).filter((p) => a.endpoints?.[p]).map((p) => ({ protocol: p, url: a.endpoints![p] })),
    capabilities: a.capabilities ?? [],
    pricing,
    payments: a.payment?.address ? [{ rail: a.payment.rail, chain: "polygon", address: a.payment.address, token: "USDC" }] : [],
  };
}

function answersFromManifest(m: AgtManifest): InitAnswers {
  const endpoints: Record<string, string> = {};
  for (const e of m.endpoints ?? []) endpoints[e.protocol] = e.url;
  const pay = (m.payments ?? []).find((p) => p.address);
  const paid = m.pricing?.paid as { currency?: string; amount?: string; unit?: string } | undefined;
  return {
    protocols: Object.keys(endpoints),
    endpoints,
    description: m.description,
    website: m.website,
    capabilities: (m.capabilities ?? []).map((c) => c.id),
    pricing: typeof m.pricing?.model === "string" ? m.pricing.model : undefined,
    paid: paid?.currency && paid.amount && paid.unit ? { currency: paid.currency, amount: paid.amount, unit: paid.unit } : undefined,
    freeTier: typeof m.pricing?.free_tier === "string" ? m.pricing.free_tier : undefined,
    payment: pay?.address ? { rail: pay.rail, address: pay.address } : null,
  };
}

// ── background data ───────────────────────────────────────────────────────────────────────────────────────────────
class Background implements CapabilitySource {
  vocab: CapabilityVocabulary = CAPABILITY_VOCABULARY;
  counts: Record<string, number> = {};
  probes = new Map<string, Promise<SelfDescription>>();
  results = new Map<string, SelfDescription>();
  private listeners: (() => void)[] = [];

  constructor(private site: string | null, private probing: boolean) {}

  vocabulary() { return this.vocab; }
  usage() { return this.counts; }
  onChange(cb: () => void): () => void { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter((l) => l !== cb); }; }
  private changed() { for (const l of this.listeners) l(); }

  /** Vocabulary and usage: /api/v2/capabilities when the site has it, else usage counted from /api/agents. */
  refreshVocabulary(): void {
    if (!this.site) return;
    const site = this.site;
    (async () => {
      try {
        const r = await fetch(`${site}/api/v2/capabilities`, { signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          const j = (await r.json()) as Partial<CapabilityVocabulary> & { usage?: Record<string, number> };
          if (Array.isArray(j.capabilities) && Array.isArray(j.categories) && j.capabilities.length) this.vocab = { categories: j.categories, capabilities: j.capabilities };
          if (j.usage) { this.counts = j.usage; this.changed(); return; }
        }
      } catch { /* fall through */ }
      try {
        const r = await fetch(`${site}/api/agents`, { signal: AbortSignal.timeout(6000) });
        const j = (await r.json()) as { agents?: { capabilities?: string[] }[] } | { capabilities?: string[] }[];
        const agents = Array.isArray(j) ? j : j.agents ?? [];
        const c: Record<string, number> = {};
        for (const a of agents) for (const id of a.capabilities ?? []) c[id] = (c[id] ?? 0) + 1;
        this.counts = c;
        this.changed();
      } catch { /* the bundled vocabulary still works */ }
    })();
  }

  startProbe(protocol: string, url: string): void {
    const key = `${protocol} ${url}`;
    if (!this.probing || this.probes.has(key)) return;
    const p = probe(protocol, url).then((d) => { this.results.set(key, d); this.changed(); return d; });
    this.probes.set(key, p);
  }

  probeFor(protocol: string, url: string) { return this.results.get(`${protocol} ${url}`); }

  /** The first self-description a live endpoint gave. */
  description(): { text: string; source: string } | null {
    for (const d of this.results.values()) if (d.live && d.description) return { text: d.description.slice(0, 280), source: `from your ${d.protocol.toUpperCase()} endpoint` };
    return null;
  }

  suggestions(): CapabilitySuggestion[] {
    const sources = [...this.results.values()].filter((d) => d.live).flatMap((d) => [
      ...d.items.map((i) => ({ from: `${i.kind} ${i.name}`, text: [i.name, i.description, ...(i.tags ?? [])].filter(Boolean).join(" ") })),
      ...(d.description ? [{ from: `${d.protocol} description`, text: d.description }] : []),
    ]);
    return suggestCapabilities(sources, { vocabulary: this.vocab }).map((s) => ({ id: s.id, from: s.from }));
  }

  async settle(ms: number) { await Promise.race([Promise.allSettled([...this.probes.values()]), new Promise((r) => setTimeout(r, ms))]); }
}

// ── the wizard ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface InitOptions {
  label?: string;
  out?: string;
  network: Network;
  probe: boolean;
  shell: ShellKind;
  log: (s: string) => void;
}

const FORMAT: Record<string, string> = {
  mcp: "https://… (your MCP endpoint URL)",
  a2a: "https://… (your A2A endpoint URL)",
  http: "https://… (your HTTP API URL)",
  ws: "wss://… (your WebSocket URL)",
};

type StepResult = "next" | "back";
interface Step { id: string; when?: () => boolean; run: () => Promise<StepResult> }

/** Turn a widget's answer into a step move: BACK goes back, SKIP clears the field and moves on. */
async function ask<T>(w: Parameters<typeof run<T>>[0], set: (v: T | undefined) => void): Promise<StepResult> {
  const v = await run<T>(w);
  if (v === BACK) return "back";
  set(v === SKIP ? undefined : (v as T));
  return "next";
}

export async function interactiveInit(o: InitOptions): Promise<{ file: string; label: string } | null> {
  const log = o.log;
  let label: string;
  if (o.label) label = normalizeLabel(o.label);
  else {
    let v: string | typeof BACK | typeof SKIP;
    do v = await run<string>(new TextInput({ label: "Name", instruction: "Enter name of agt", nav: false, validate: (s) => { try { normalizeLabel(s); return null; } catch (e) { return (e as Error).message; } } }));
    while (typeof v !== "string");
    label = normalizeLabel(v);
  }

  const bg = new Background(o.network.site, o.probe);
  bg.refreshVocabulary();
  const resolver = new AgtResolver({ chain: o.network.name, rpcUrls: o.network.rpcUrls, registry: o.network.registry, timeoutMs: 8000 });
  const currentP = resolver.resolveAgent(`${label}.agt`).then((r) => (r.manifest && r.verified ? r.manifest : null)).catch(() => null);

  // Resume a draft, or start from the published manifest's values as prefills.
  let a: InitAnswers = {};
  const draft = loadDraft(label);
  if (draft) {
    const resume = await run(new Select({ label: "Draft", instruction: `You have an unfinished draft for ${label}.agt from ${ago(draft.savedAt)}`, choices: [{ value: true, label: "Resume it" }, { value: false, label: "Start over" }], initial: true }));
    if (resume === false) clearDraft(label); else a = draft.answers;   // only an explicit "Start over" discards it
  }
  const current = await Promise.race([currentP, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
  const pre: InitAnswers = current ? answersFromManifest(current) : {};
  if (current && !draft) log(style.dim(`  ${label}.agt has a published manifest; its values are offered as suggestions (Tab to keep each).`));
  const fromCurrent = (has: unknown) => (has !== undefined && has !== null ? "from your current manifest" : undefined);
  const paidModel = () => a.pricing === "paid" || a.pricing === "freemium";

  // Each step pre-fills with your earlier answer (going back, or a resumed draft), else the current manifest, else a
  // prediction. j goes back one step, ; skips it.
  const steps: Step[] = [
    {
      id: "endpoints",
      run: async () => {
        const urls = a.endpoints ?? {};
        const rows = PROTOCOLS.map((p) => ({
          protocol: p.value, label: p.label, format: FORMAT[p.value],
          url: urls[p.value] ?? "", on: !!urls[p.value],
          prefill: pre.endpoints?.[p.value], prefillSource: fromCurrent(pre.endpoints?.[p.value]),
        }));
        for (const r of rows) if (r.on) bg.startProbe(r.protocol, r.url);
        return ask<Record<string, string>>(new EndpointsInput({
          label: "Endpoints",
          rows,
          validate: (p, v) => httpsUrl(p)(v),
          onSave: (p, v) => bg.startProbe(p, v),
          status: (p, v) => {
            const d = bg.probeFor(p, v);
            if (!o.probe) return null;
            if (!d) return style.dim("checking…");
            if (!d.live) return style.yellow(`! no answer (${d.error})`);
            return style.green("✓ live") + (d.items.length ? style.dim(` · ${d.items.length} ${d.items[0].kind}${d.items.length === 1 ? "" : "s"}`) : "");
          },
          onChange: (cb) => bg.onChange(cb),
        }), (v) => { a.endpoints = v ?? {}; a.protocols = Object.keys(a.endpoints); });
      },
    },
    {
      id: "description",
      run: async () => {
        await bg.settle(2000);
        const fromProbe = bg.description();
        return ask<string>(new TextInput({
          label: "Description",
          instruction: "Enter a one-line description of what your agent does",
          initial: a.description,
          prefill: pre.description ?? fromProbe?.text,
          prefillSource: pre.description ? "from your current manifest" : fromProbe?.source,
          examples: ["Hourly and 10-day weather forecasts for any city", "Summarizes long PDFs into cited key points"],
          maxLength: 280,
          validate: (v) => (v.length > 280 ? "Keep it to 280 characters" : null),
        }), (v) => { a.description = v; });
      },
    },
    {
      id: "website",
      run: async () => {
        const first = Object.values(a.endpoints ?? {})[0];
        const origin = first ? new URL(first).origin.replace(/^wss:/, "https:") : undefined;
        return ask<string>(new TextInput({
          label: "Website", instruction: "Enter your agent's homepage URL",
          initial: a.website,
          prefill: pre.website ?? origin,
          prefillSource: pre.website ? "from your current manifest" : origin ? "your endpoint's site" : undefined,
          optional: true, validate: httpsUrl("http"),
        }), (v) => { a.website = v || undefined; });
      },
    },
    {
      id: "capabilities",
      run: async () => {
        await bg.settle(1500);
        return ask<string[]>(new CapabilityPicker(bg, { label: "Capabilities", initial: a.capabilities ?? pre.capabilities }), (v) => { a.capabilities = v; });
      },
    },
    {
      id: "pricing",
      run: () => ask<string>(new Select({
        label: "Pricing", instruction: "Choose how your agent charges",
        choices: [
          { value: "free", label: "Free", description: "No charge" },
          { value: "freemium", label: "Freemium", description: "A free tier, then paid" },
          { value: "paid", label: "Paid", description: "Every use is charged" },
          { value: "contact", label: "Contact", description: "Pricing on request" },
        ],
        initial: a.pricing ?? pre.pricing ?? "free",
        prefillSource: !a.pricing && pre.pricing ? "from your current manifest" : undefined,
      }), (v) => { a.pricing = v; }),
    },
    {
      id: "free-tier", when: () => a.pricing === "freemium",
      run: () => ask<string>(new TextInput({ label: "Free tier", instruction: "Enter what the free tier includes", initial: a.freeTier, prefill: pre.freeTier, prefillSource: fromCurrent(pre.freeTier), optional: true }), (v) => { a.freeTier = v || undefined; }),
    },
    {
      id: "currency", when: paidModel,
      run: () => ask<string>(new Select({ label: "Currency", instruction: "Choose what you charge in", choices: [{ value: "USDC", label: "USDC" }, { value: "USD", label: "USD" }, { value: "EUR", label: "EUR" }], initial: a.paid?.currency ?? pre.paid?.currency ?? "USDC" }),
        (v) => { a.paid = { currency: v ?? "USDC", amount: a.paid?.amount ?? "", unit: a.paid?.unit ?? "per_request" }; }),
    },
    {
      id: "price", when: paidModel,
      run: () => ask<string>(new TextInput({
        label: "Price", instruction: `Enter the price in ${a.paid?.currency ?? "USDC"} as a decimal number`,
        initial: a.paid?.amount || undefined, prefill: pre.paid?.amount, prefillSource: fromCurrent(pre.paid?.amount),
        validate: (v) => (/^\d+(\.\d+)?$/.test(v) ? null : "Use a decimal number like 0.01"),
      }), (v) => { a.paid = { currency: a.paid?.currency ?? "USDC", amount: v ?? "", unit: a.paid?.unit ?? "per_request" }; }),
    },
    {
      id: "unit", when: paidModel,
      run: () => ask<string>(new Select({
        label: "Per", instruction: "Choose what one price unit is",
        choices: ["per_request", "per_session", "per_minute", "per_month", "per_token_in", "per_token_out"].map((u) => ({ value: u, label: u.replace(/_/g, " ") })),
        initial: a.paid?.unit ?? pre.paid?.unit ?? "per_request",
      }), (v) => { a.paid = { currency: a.paid?.currency ?? "USDC", amount: a.paid?.amount ?? "", unit: v ?? "per_request" }; }),
    },
    {
      id: "payment-address", when: paidModel,
      run: () => ask<string>(new TextInput({
        label: "Payment address", instruction: "Enter the 0x address that receives payments",
        initial: a.payment?.address, prefill: pre.payment?.address, prefillSource: fromCurrent(pre.payment?.address),
        optional: true, validate: (v) => (/^0x[0-9a-fA-F]{40}$/.test(v) ? null : "Use a 0x address (40 hex characters)"),
      }), (v) => { a.payment = v ? { rail: a.payment?.rail ?? pre.payment?.rail ?? "x402", address: v } : null; }),
    },
    {
      id: "payment-rail", when: () => paidModel() && !!a.payment?.address,
      run: () => ask<string>(new Select({ label: "Payment rail", instruction: "Choose how clients pay that address", choices: [{ value: "x402", label: "x402", description: "HTTP 402 pay-per-request" }, { value: "evm", label: "EVM transfer", description: "Plain on-chain transfer" }], initial: a.payment?.rail ?? "x402" }),
        (v) => { if (a.payment) a.payment.rail = v ?? "x402"; }),
    },
  ];

  // Walk the steps. Each finished step leaves one summary line; going back erases it and re-opens that step there.
  let i = 0;
  const done: number[] = [];
  while (i < steps.length) {
    const s = steps[i];
    if (s.when && !s.when()) { i++; continue; }
    const r = await s.run();
    if (r === "back") {
      const prev = done.pop();
      if (prev === undefined) continue;          // first step: nothing to go back to
      eraseLines(1);
      i = prev;
      continue;
    }
    saveDraft(label, a);
    done.push(i);
    i++;
  }
  if (!paidModel()) { a.paid = undefined; a.freeTier = undefined; a.payment = null; }

  // Review and write.
  const input = answersToInput(a);
  const file = o.out ?? `${label}.manifest.json`;
  log("");
  log(style.bold(`${label}.agt manifest`));
  log(`  ${style.dim("description")}  ${input.description ?? style.dim("(skipped)")}`);
  if (input.website) log(`  ${style.dim("website")}      ${input.website}`);
  if (!input.endpoints?.length) log(`  ${style.dim("endpoints")}    ${style.dim("(skipped)")}`);
  for (const e of input.endpoints ?? []) log(`  ${style.dim(e.protocol.padEnd(12))} ${e.url}`);
  log(`  ${style.dim("capabilities")} ${(a.capabilities ?? []).join(", ") || style.dim("none")}`);
  log(`  ${style.dim("pricing")}      ${a.pricing ?? style.dim("(skipped)")}${a.paid?.amount ? ` · ${a.paid.amount} ${a.paid.currency} ${a.paid.unit.replace(/_/g, " ")}` : ""}${a.payment ? ` · ${a.payment.rail} to ${a.payment.address}` : ""}`);
  const exists = existsSync(file);
  const next = await run(new Select({
    label: "Next", instruction: `Write ${file}${exists ? " (it exists and will be replaced)" : ""}`,
    choices: [
      { value: "write", label: "Write the file", description: "then publish when ready" },
      { value: "publish", label: "Write and publish now", description: "signs in your wallet, hosts it, sets the records" },
      { value: "quit", label: "Not yet", description: "keep the draft for later" },
    ],
    initial: "write",
  }));
  if (next === BACK) { log(style.dim(`Draft kept. Run agt manifest init ${label} to change an answer.`)); return null; }
  if (next === "quit" || next === SKIP) { log(style.dim(`Draft kept. Run agt manifest init ${label} to pick it up.`)); return null; }
  writeFileSync(file, JSON.stringify(input, null, 2) + "\n");
  clearDraft(label);
  log(`${style.green("✔")} Wrote ${file}`);

  // The equivalent command, as a plain line to run or copy (R-6).
  const net = o.network.name === "polygon" ? [] : ["--network", o.network.name];
  const cmd = ["agt", "manifest", "publish", label, file, ...net].map((x) => shellQuote(x, o.shell)).join(" ");
  if (next === "publish") {
    log(style.dim(`Running: ${cmd}`));
    const code = await new Promise<number>((res) => spawn(process.execPath, [process.argv[1], "manifest", "publish", label, resolvePath(file), ...net], { stdio: "inherit" }).on("exit", (c) => res(c ?? 1)));
    process.exitCode = code;
    return { file, label };
  }
  log("");
  log("Publish it with:");
  log("");
  log(cmd);
  log("");
  copyToClipboard(cmd);
  log(style.dim(`(copied to the clipboard · ${o.shell} quoting · --shell bash|powershell to change)`));
  return { file, label };
}

export { CancelledError };
