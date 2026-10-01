/**
 * The capability picker. Ranked results (best match first and highlighted, @agtnames/resolver rankCapabilities), a
 * fixed viewport with "N more", the highlighted item's description on its own line, suggestions read from the
 * agent's own tools pre-ticked and labelled with where they came from, a category drill-down, and custom ids with
 * "did you mean" (spec §4.2: custom ids allowed, lowercase hyphenated).
 */
import { nearestCapability, rankCapabilities, toCapabilityId, type CapabilityDef, type CapabilityVocabulary } from "@agtnames/resolver";
import { BACK, copyToClipboard, SKIP, style, type Frame, type Key, type Nav, type Widget } from "./tui.js";

export interface CapabilitySuggestion { id: string; from: string[] }

export interface CapabilitySource {
  vocabulary(): CapabilityVocabulary;
  usage(): Record<string, number>;
  suggestions(): CapabilitySuggestion[];
  /** Register a callback for when background data (vocabulary refresh, endpoint probes) arrives. */
  onChange(cb: () => void): (() => void) | void;
}

type Row =
  | { kind: "heading"; text: string }
  | { kind: "cap"; cap: CapabilityDef; from?: string[] }
  | { kind: "custom"; id: string; known?: CapabilityDef }
  | { kind: "category"; id: string; label: string; count: number };

const VIEW = 8;

export class CapabilityPicker implements Widget<string[] | Nav> {
  get label() { return this.o.label; }
  private query = "";
  private selected: string[];
  private i = 0;
  private top = 0;
  private mode: "search" | "categories" | "category" = "search";
  private category: string | null = null;
  private catIndex = 0;
  private flash: string | null = null;
  private seenSuggestions = new Set<string>();

  constructor(private src: CapabilitySource, private o: { label: string; initial?: string[] }) {
    this.selected = [...(o.initial ?? [])];
    this.absorbSuggestions();
  }

  /** New suggestions are pre-ticked once; unticking one sticks. */
  private absorbSuggestions() {
    for (const s of this.src.suggestions()) {
      if (this.seenSuggestions.has(s.id)) continue;
      this.seenSuggestions.add(s.id);
      if (!this.selected.includes(s.id)) this.selected.push(s.id);
    }
  }

  private off?: (() => void) | void;
  attach(redraw: () => void) { this.off = this.src.onChange(() => { this.absorbSuggestions(); redraw(); }); }
  detach() { if (this.off) this.off(); }

  private capOf(id: string): CapabilityDef | undefined { return this.src.vocabulary().capabilities.find((c) => c.id === id); }
  private uses(id: string) { return this.src.usage()[id] ?? 0; }

  private rows(): Row[] {
    const vocab = this.src.vocabulary();
    const usage = this.src.usage();
    if (this.mode === "categories") {
      return vocab.categories.map((c) => ({ kind: "category" as const, id: c.id, label: c.label, count: vocab.capabilities.filter((x) => x.category === c.id && !x.deprecated).length }));
    }
    if (this.mode === "category") {
      return vocab.capabilities.filter((c) => c.category === this.category && !c.deprecated).sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0)).map((cap) => ({ kind: "cap" as const, cap }));
    }
    const q = this.query.trim();
    if (!q) {
      const sugg = this.src.suggestions();
      const rows: Row[] = [];
      if (sugg.length) {
        rows.push({ kind: "heading", text: "Suggested from your agent's own description" });
        for (const s of sugg) { const cap = this.capOf(s.id); if (cap) rows.push({ kind: "cap", cap, from: s.from }); }
      }
      const others = this.selected.filter((id) => !sugg.some((s) => s.id === id));
      if (others.length) {
        rows.push({ kind: "heading", text: "Selected" });
        for (const id of others) { const cap = this.capOf(id); rows.push(cap ? { kind: "cap", cap } : { kind: "custom", id }); }
      }
      rows.push({ kind: "heading", text: "Most used" });
      const shown = new Set(rows.flatMap((r) => (r.kind === "cap" ? [r.cap.id] : [])));
      for (const r of rankCapabilities("", { vocabulary: vocab, usage })) if (!shown.has(r.capability.id)) rows.push({ kind: "cap", cap: r.capability });
      return rows;
    }
    const ranked = rankCapabilities(q, { vocabulary: vocab, usage });
    const rows: Row[] = ranked.map((r) => ({ kind: "cap" as const, cap: r.capability }));
    const id = toCapabilityId(q);
    const exact = ranked.some((r) => r.capability.id === id);
    if (id && !exact) {
      const near = nearestCapability(id, vocab);
      if (near && !ranked.slice(0, 3).some((r) => r.capability.id === near.id)) rows.unshift({ kind: "cap", cap: near, from: [`did you mean ${near.id}?`] });
      rows.push({ kind: "custom", id, known: near ?? undefined });
    }
    return rows;
  }

  private selectable = (r: Row) => r.kind !== "heading";

  private clampCursor(rows: Row[]) {
    if (!rows.length) { this.i = 0; return; }
    this.i = Math.max(0, Math.min(this.i, rows.length - 1));
    if (!this.selectable(rows[this.i])) {
      const next = rows.findIndex((r, k) => k > this.i && this.selectable(r));
      this.i = next >= 0 ? next : rows.findIndex(this.selectable);
    }
    if (this.i < this.top) this.top = this.i;
    if (this.i >= this.top + VIEW) this.top = this.i - VIEW + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, rows.length - VIEW)));
    if (this.top > 0 && rows[this.top - 1]?.kind === "heading" && this.i - (this.top - 1) < VIEW) this.top--;
  }

  private move(rows: Row[], d: 1 | -1) {
    let k = this.i;
    for (let n = 0; n < rows.length; n++) { k = (k + d + rows.length) % rows.length; if (this.selectable(rows[k])) { this.i = k; return; } }
  }

  private toggle(id: string) {
    const at = this.selected.indexOf(id);
    if (at >= 0) this.selected.splice(at, 1); else this.selected.push(id);
  }

  private topMatch(): CapabilityDef | undefined {
    const q = this.query.trim();
    return q ? rankCapabilities(q, { vocabulary: this.src.vocabulary(), usage: this.src.usage(), limit: 1 })[0]?.capability : undefined;
  }

  render(): Frame {
    const rows = this.rows();
    this.clampCursor(rows);
    const vocab = this.src.vocabulary();
    const lines: string[] = [];
    const where = this.mode === "categories" ? style.dim("  · categories") : this.mode === "category" ? style.dim(`  · ${vocab.categories.find((c) => c.id === this.category)?.label ?? ""}`) : "";
    lines.push(`${style.cyan("?")} ${style.bold(this.o.label)}  Choose what your agent can do${where}`);

    // Input line: the instruction sits in the field until you type; then the top match completes dimly after the cursor.
    const tm = this.topMatch();
    let field: string;
    if (this.mode !== "search") field = style.dim("← back to search");
    else if (!this.query) field = style.dim("Search capabilities");
    else field = this.query + (tm && tm.id.startsWith(this.query.toLowerCase()) && tm.id.length > this.query.length ? style.dim(tm.id.slice(this.query.length)) : "");
    lines.push("› " + field);
    const cursorCol = 2 + (this.mode === "search" ? this.query.length : 0);

    const view = rows.slice(this.top, this.top + VIEW);
    if (this.top > 0) lines.push(style.dim(`   ↑ ${this.top} more`));
    view.forEach((r, k) => {
      const idx = this.top + k;
      const on = idx === this.i;
      const ptr = on ? style.cyan("❯") : " ";
      if (r.kind === "heading") { lines.push(" " + style.dim(r.text)); return; }
      if (r.kind === "category") { lines.push(`${ptr} ${on ? style.bold(r.label) : r.label} ${style.dim(`(${r.count})`)}  ${style.dim("→")}`); return; }
      if (r.kind === "custom") {
        const sel = this.selected.includes(r.id);
        lines.push(`${ptr} ${sel ? style.green("[x]") : "[ ]"} ${on ? style.bold(r.id) : r.id}  ${style.yellow("custom")}${sel ? "" : style.dim("  Enter adds it as your own capability")}`);
        return;
      }
      const sel = this.selected.includes(r.cap.id);
      const n = this.uses(r.cap.id);
      const from = r.from?.length ? style.dim(`  ← ${r.from.slice(0, 2).join(", ")}${r.from.length > 2 ? "…" : ""}`) : "";
      lines.push(`${ptr} ${sel ? style.green("[x]") : "[ ]"} ${on ? style.bold(r.cap.id.padEnd(22)) : r.cap.id.padEnd(22)} ${style.dim(n ? `${n} agent${n === 1 ? "" : "s"}` : "")}${from}`);
    });
    const below = rows.length - (this.top + VIEW);
    if (below > 0) lines.push(style.dim(`   ↓ ${below} more`));
    if (!rows.length) lines.push(style.dim("   no matches"));

    // Detail of the highlighted row, on its own line so the list never has to cram it.
    const cur = rows[this.i];
    if (cur?.kind === "cap") lines.push(`  ${style.bold(cur.cap.label)}: ${cur.cap.description} ${style.dim(`· ${vocab.categories.find((c) => c.id === cur.cap.category)?.label ?? cur.cap.category}`)}`);
    else if (cur?.kind === "custom") lines.push(`  ${style.yellow("custom")}: not in the shared list. Other agents searching for it won't find it unless they use the same id.${cur.known ? ` Closest shared term: ${cur.known.id}.` : ""}`);
    else if (cur?.kind === "category") lines.push(`  ${vocab.categories.find((c) => c.id === cur.id)?.description ?? ""}`);
    else lines.push("");

    lines.push(`  ${style.dim("Selected:")} ${this.selected.length ? style.cyan(this.selected.join(", ")) : style.dim("none yet")}${this.flash ? "  " + style.green(this.flash) : ""}`);
    const hint = this.mode !== "search"
      ? "↑/↓ move · Space or Enter toggles · ← categories · Esc search · j back · ; skip"
      : this.query
        ? "↑/↓ move · Enter toggles the highlighted row · Tab completes · Esc clears · ^Y copies the id"
        : "type to search · ↑/↓ move · Space toggles · → categories · Enter when done · ^Y copy id · j back · ; skip";
    lines.push(style.dim("  " + hint));
    return { lines, cursor: { row: 1, col: cursorCol } };
  }

  onKey(str: string | undefined, key: Key): { done: string[] | Nav } | void {
    this.flash = null;
    if (!this.query && !key.ctrl && !key.meta) {
      if (str === "j") return { done: BACK };
      if (str === ";") return { done: SKIP };
    }
    const rows = this.rows();
    this.clampCursor(rows);
    const cur = rows[this.i];
    const idOf = (r: Row | undefined) => (r?.kind === "cap" ? r.cap.id : r?.kind === "custom" ? r.id : null);

    if (key.ctrl && key.name === "y") { const id = idOf(cur); if (id) { copyToClipboard(id); this.flash = `copied ${id}`; } return; }
    if (key.name === "up") return this.move(rows, -1);
    if (key.name === "down") return this.move(rows, 1);
    if (key.name === "pageup") { this.i = Math.max(0, this.i - VIEW); return; }
    if (key.name === "pagedown") { this.i = Math.min(rows.length - 1, this.i + VIEW); return; }

    if (this.mode === "categories") {
      if (key.name === "escape" || key.name === "left") { this.mode = "search"; this.i = 0; this.top = 0; return; }
      if ((key.name === "return" || key.name === "right") && cur?.kind === "category") { this.catIndex = this.i; this.category = cur.id; this.mode = "category"; this.i = 0; this.top = 0; }
      return;
    }
    if (this.mode === "category") {
      if (key.name === "left") { this.mode = "categories"; this.i = this.catIndex; this.top = 0; return; }
      if (key.name === "escape") { this.mode = "search"; this.i = 0; this.top = 0; return; }
      if (key.name === "space" || str === " " || key.name === "return") { const id = idOf(cur); if (id) this.toggle(id); }
      return;
    }

    // search mode
    if (key.name === "escape") { this.query = ""; this.i = 0; this.top = 0; return; }
    if (key.name === "right" && !this.query) { this.mode = "categories"; this.i = 0; this.top = 0; return; }
    if (key.name === "tab") { const tm = this.topMatch(); if (tm) this.query = tm.id; this.i = 0; return; }
    if (key.name === "return" || key.name === "enter") {
      if (!this.query.trim()) return { done: [...this.selected] };
      const id = idOf(cur);
      if (id) { this.toggle(id); this.flash = this.selected.includes(id) ? `added ${id}` : `removed ${id}`; }
      this.query = ""; this.i = 0; this.top = 0;
      return;
    }
    if ((key.name === "space" || str === " ") && !this.query) { const id = idOf(cur); if (id) this.toggle(id); return; }
    if (key.name === "backspace") { this.query = this.query.slice(0, -1); this.i = 0; this.top = 0; return; }
    if (key.ctrl && key.name === "u") { this.query = ""; this.i = 0; this.top = 0; return; }
    if (str && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(str)) { this.query += str; this.i = 0; this.top = 0; }
  }

  summary(v: string[] | Nav) {
    if (!Array.isArray(v)) return ""; return `${style.green("✔")} ${style.bold(this.o.label)} ${v.length ? style.cyan(v.join(", ")) : style.dim("(none)")}`; }
}
