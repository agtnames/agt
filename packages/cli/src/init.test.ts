/** The interactive pieces, driven by keys without a terminal: placeholder rules (R-5, R-6), the picker, drafts, quoting. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPABILITY_VOCABULARY } from "@agtnames/resolver";
import { answersToInput, clearDraft, detectShell, loadDraft, saveDraft, shellQuote } from "./init.js";
import { CapabilityPicker, type CapabilitySource } from "./picker.js";
import { Checkbox, Select, TextInput } from "./widgets.js";

const type = (w: { onKey: (s: string | undefined, k: any) => unknown }, text: string) => { for (const ch of text) w.onKey(ch, { name: ch }); };
const key = (w: { onKey: (s: string | undefined, k: any) => unknown }, name: string, extra: object = {}) => w.onKey(undefined, { name, ...extra });

test("instruction sits in the empty field, cursor at its start; no prefill means Tab does nothing", () => {
  const w = new TextInput({ label: "Name", instruction: "Enter name of agt" });
  const f = w.render();
  assert.equal(f.lines[0], "? Name");
  assert.equal(f.lines[1], "› Enter name of agt");
  assert.deepEqual(f.cursor, { row: 1, col: 2 });
  key(w, "tab");
  assert.equal(w.value, "");
});

test("a prefill occupies the field, the instruction stays primary on the label line, Tab fills and Enter submits", () => {
  const w = new TextInput({ label: "Description", instruction: "Enter a one-line description", prefill: "Weather forecasts", prefillSource: "from your MCP server" });
  let f = w.render();
  assert.equal(f.lines[0], "? Description  Enter a one-line description");
  assert.equal(f.lines[1], "› Weather forecasts");
  assert.equal(f.cursor.col, 2, "cursor before the suggestion");
  assert.match(f.lines[2], /Tab fills the suggestion · Enter submits/);
  assert.match(f.lines[2], /from your MCP server/);
  assert.equal(key(w, "return"), undefined, "Enter alone on an empty field does not take the suggestion");
  assert.match(w.render().lines.at(-1)!, /Tab fills the suggestion, or type your own/);
  key(w, "tab");
  assert.deepEqual(key(w, "return"), { done: "Weather forecasts" });
});

test("typing over a prefill never loses it: it stays on the hint line, ↑ restores it, Esc only clears the field", () => {
  const w = new TextInput({ label: "Website", instruction: "Enter your homepage URL", prefill: "https://w.example" });
  type(w, "https://mine.example");
  const f = w.render();
  assert.equal(f.lines[1], "› https://mine.example");
  assert.match(f.lines[2], /suggested: https:\/\/w\.example .*↑ restore · \^Y copy/);
  key(w, "escape");
  assert.equal(w.value, "");
  assert.equal(w.render().lines[1], "› https://w.example", "suggestion back in the field after clearing");
  type(w, "x");
  key(w, "up");
  assert.equal(w.value, "https://w.example");
});

test("a typed prefix of the prefill shows the rest dimly after the cursor; → takes one more character", () => {
  const w = new TextInput({ label: "URL", instruction: "Enter the URL", prefill: "https://w.example/mcp" });
  type(w, "https://w.");
  const f = w.render();
  assert.equal(f.lines[1], "› https://w.example/mcp");
  assert.equal(f.cursor.col, 2 + "https://w.".length);
  key(w, "right");
  assert.equal(w.value, "https://w.e");
});

test("examples stay hidden until ~3 s idle on an empty field, and are never fillable", () => {
  const w = new TextInput({ label: "Description", instruction: "Enter a description", examples: ["Hourly forecasts"] });
  assert.ok(!w.render().lines.some((l) => l.includes("e.g.")));
  (w as unknown as { lastKey: number }).lastKey = Date.now() - 4000;
  assert.ok(w.render().lines.some((l) => l.includes("e.g. Hourly forecasts")));
  assert.equal(w.render().lines[1], "› Enter a description", "the instruction remains the field's text");
  key(w, "tab");
  assert.equal(w.value, "", "Tab does not fill an example");
  type(w, "a");
  assert.ok(!w.render().lines.some((l) => l.includes("e.g.")), "typing hides the example");
});

test("validation and optional fields", () => {
  const w = new TextInput({ label: "URL", instruction: "Enter the URL", validate: (v) => (v.startsWith("https://") ? null : "Use https://") });
  type(w, "http://x");
  assert.equal(key(w, "return"), undefined);
  assert.match(w.render().lines.at(-1)!, /Use https:\/\//);
  const o = new TextInput({ label: "Website", instruction: "Enter it", optional: true });
  assert.deepEqual(key(o, "return"), { done: "" });
});

test("Select keeps the prefilled choice selected; Checkbox enforces a minimum", () => {
  const s = new Select({ label: "Pricing", instruction: "Choose", choices: [{ value: "free", label: "Free" }, { value: "paid", label: "Paid" }], initial: "paid" });
  assert.deepEqual(s.onKey(undefined, { name: "return" }), { done: "paid" });
  const c = new Checkbox({ label: "Endpoints", instruction: "Choose", choices: [{ value: "mcp", label: "MCP" }, { value: "a2a", label: "A2A" }], min: 1 });
  assert.equal(c.onKey(undefined, { name: "return" }), undefined);
  c.onKey(" ", { name: "space" });
  assert.deepEqual(c.onKey(undefined, { name: "return" }), { done: ["mcp"] });
});

function source(suggestions: { id: string; from: string[] }[] = [], usage: Record<string, number> = {}): CapabilitySource {
  return { vocabulary: () => CAPABILITY_VOCABULARY, usage: () => usage, suggestions: () => suggestions, onChange: () => {} };
}

test("picker: the best match is the first, highlighted row (the GUI's out-of-view problem) and Enter adds it", () => {
  const p = new CapabilityPicker(source(), { label: "Capabilities" });
  type(p, "search");
  const f = p.render();
  const firstRow = f.lines.find((l) => /\[[ x]\]/.test(l))!;
  assert.match(firstRow, /^❯ \[ \] search\b/);
  key(p, "return");
  assert.match(p.render().lines.find((l) => l.includes("Selected:"))!, /Selected: search/);
  assert.deepEqual(key(p, "return"), { done: ["search"] }, "Enter on an empty search finishes");
});

test("picker: suggestions from the agent's tools are pre-ticked, labelled with their source, and can be unticked", () => {
  const p = new CapabilityPicker(source([{ id: "forecasting", from: ["tool get_forecast"] }]), { label: "Capabilities" });
  const lines = p.render().lines;
  assert.ok(lines.some((l) => /Suggested from your agent/.test(l)));
  assert.ok(lines.some((l) => /\[x\] forecasting .*← tool get_forecast/.test(l)));
  p.onKey(" ", { name: "space" });
  assert.deepEqual(key(p, "return"), { done: [] });
});

test("picker: unknown text offers a did-you-mean and a custom id; Tab completes the top match", () => {
  const p = new CapabilityPicker(source(), { label: "Capabilities" });
  type(p, "forcasting");
  const lines = p.render().lines;
  assert.ok(lines.some((l) => /forecasting .*did you mean forecasting\?/.test(l)));
  assert.ok(lines.some((l) => /forcasting {2}custom/.test(l)));
  key(p, "escape");
  type(p, "fact");
  key(p, "tab");
  assert.match(p.render().lines[1], /^› fact-checking$/);
});

test("picker: → on an empty search browses categories, then a category's capabilities", () => {
  const p = new CapabilityPicker(source(), { label: "Capabilities" });
  key(p, "right");
  assert.ok(p.render().lines.some((l) => /Language \(\d+\)/.test(l)));
  key(p, "return");
  key(p, "return");
  key(p, "escape");
  assert.equal((key(p, "return") as { done: string[] }).done.length, 1);
});

test("drafts round-trip and clear", () => {
  process.env.AGT_DRAFT_DIR = mkdtempSync(join(tmpdir(), "agt-drafts-"));
  saveDraft("weather", { description: "x", protocols: ["mcp"] });
  assert.deepEqual(loadDraft("weather")?.answers, { description: "x", protocols: ["mcp"] });
  clearDraft("weather");
  assert.equal(loadDraft("weather"), null);
});

test("answersToInput builds a spec-shaped input; shell quoting per shell", () => {
  const i = answersToInput({ protocols: ["mcp", "a2a"], endpoints: { mcp: "https://w.example/mcp", a2a: "https://w.example/a2a" }, description: "d", capabilities: ["forecasting"], pricing: "paid", paid: { currency: "USDC", amount: "0.01", unit: "per_request" }, payment: { rail: "x402", address: "0x" + "1".repeat(40) } });
  assert.deepEqual(i.pricing, { model: "paid", paid: { currency: "USDC", amount: "0.01", unit: "per_request" } });
  assert.equal(i.endpoints!.length, 2);
  assert.equal(i.payments![0].rail, "x402");
  assert.equal(shellQuote("weather.manifest.json", "powershell"), "weather.manifest.json");
  assert.equal(shellQuote("my file's.json", "powershell"), "'my file''s.json'");
  assert.equal(shellQuote("my file's.json", "bash"), `'my file'\\''s.json'`);
  assert.equal(detectShell({}, "win32"), "powershell");
  assert.equal(detectShell({ SHELL: "/usr/bin/bash" }, "win32"), "bash");
  assert.equal(detectShell({}, "linux"), "bash");
});

// ── navigation: j back, ; skip ────────────────────────────────────────────────────────────────────────────────────
import { BACK, SKIP } from "./tui.js";
import { EndpointsInput, type EndpointRow } from "./endpoints.js";

test("j and ; navigate on an empty field, and are ordinary characters once you have typed", () => {
  const w = new TextInput({ label: "Description", instruction: "Enter a description" });
  assert.deepEqual(w.onKey("j", { name: "j" }), { done: BACK });
  assert.deepEqual(w.onKey(";", { name: ";" }), { done: SKIP });
  type(w, "Just");
  w.onKey("j", { name: "j" });
  w.onKey(";", { name: ";" });
  assert.equal(w.value, "Justj;");
  const embedded = new TextInput({ label: "URL", instruction: "https://…", nav: false });
  embedded.onKey("j", { name: "j" });
  assert.equal(embedded.value, "j", "fields inside another widget never navigate");
});

test("lists and the picker take j / ; directly (picker only while its search is empty)", () => {
  const s = new Select({ label: "Pricing", instruction: "Choose", choices: [{ value: "free", label: "Free" }] });
  assert.deepEqual(s.onKey("j", { name: "j" }), { done: BACK });
  assert.deepEqual(s.onKey(";", { name: ";" }), { done: SKIP });
  const p = new CapabilityPicker(source(), { label: "Capabilities" });
  assert.deepEqual(p.onKey("j", { name: "j" }), { done: BACK });
  type(p, "aj");
  assert.match(p.render().lines[1], /^› aj/, "j types into a search that has started");
});

function endpoints(saved: string[] = []) {
  const rows: EndpointRow[] = ["mcp", "a2a", "http"].map((p) => ({ protocol: p, label: p.toUpperCase(), format: `https://… (your ${p.toUpperCase()} endpoint URL)`, url: "", on: false }));
  return new EndpointsInput({
    label: "Endpoints", rows,
    validate: (_p, v) => (v.startsWith("https://") ? null : "Use https://"),
    status: () => null,
    onSave: (p, v) => saved.push(`${p} ${v}`),
    onChange: () => () => {},
  });
}

test("endpoints: Tab focuses the row's input showing the format; Enter saves, ticks and moves to the next row", () => {
  const saved: string[] = [];
  const e = endpoints(saved);
  assert.match(e.render().lines[1], /^❯ \[ \] MCP +https:\/\/… \(your MCP endpoint URL\)/);
  key(e, "tab");
  const f = e.render();
  assert.match(f.lines[1], /^❯ \[ \] MCP +https:\/\/… \(your MCP endpoint URL\)/, "the format sits in the empty input");
  assert.equal(f.cursor.row, 1);
  type(e, "https://a.example/mcp");
  key(e, "return");
  assert.deepEqual(saved, ["mcp https://a.example/mcp"]);
  const g = e.render();
  assert.match(g.lines[1], /^ {2}\[x\] MCP +https:\/\/a\.example\/mcp/);
  assert.match(g.lines[2], /^❯ \[ \] A2A/, "focus moved to the next row");
});

test("endpoints: the next row prefills next to the first one; Enter twice advances with what was entered", () => {
  const e = endpoints();
  key(e, "tab"); type(e, "https://a.example/mcp"); key(e, "return");
  key(e, "tab");
  assert.match(e.render().lines[2], /A2A +https:\/\/a\.example\/a2a/, "suggested from the MCP origin");
  key(e, "tab");                     // fill the suggestion
  key(e, "return");                  // save the row
  assert.deepEqual(key(e, "return"), { done: { mcp: "https://a.example/mcp", a2a: "https://a.example/a2a" } });
});

test("endpoints: validation, Enter with nothing entered, Esc, j and ;", () => {
  const e = endpoints();
  assert.equal(key(e, "return"), undefined);
  assert.match(e.render().lines.at(-2)!, /Add at least one URL/);
  key(e, "tab"); type(e, "http://x"); key(e, "return");
  assert.ok(e.render().lines.some((l) => /Use https:\/\//.test(l)), "invalid URL stays in the input with the error");
  for (let k = 0; k < 8; k++) key(e, "backspace");
  key(e, "escape");
  assert.match(e.render().lines.at(-1)!, /Tab edit the URL/, "Esc on an empty input returns to the list");
  assert.deepEqual(e.onKey("j", { name: "j" }), { done: BACK });
  assert.deepEqual(e.onKey(";", { name: ";" }), { done: SKIP });
});
