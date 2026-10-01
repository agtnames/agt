/**
 * Prompt widgets. The placeholder rules (RATIONALE R-5, R-6):
 *   prefill      a prediction from real data, dim after the cursor; Tab fills it, Enter submits. Typing over it never
 *                loses it: it stays on the hint line, ↑ puts it back, ^Y copies it.
 *   instruction  says what to enter; in the field when there is no prefill, otherwise on the label line. Always primary.
 *   examples     only on an empty field after ~3 s idle, fading in italic below it; never fillable.
 *
 * Step navigation: `j` goes back a step and `;` skips it. In lists they are plain keys; in a typing field they act
 * only while the field is empty, so a value containing j or ; types normally.
 */
import { BACK, copyToClipboard, SKIP, style, type Frame, type Key, type Nav, type Widget } from "./tui.js";

const PROMPT = "› ";
const IDLE_MS = 3000;
const FADE = [236, 238, 240, 242, 244];

const printable = (str: string | undefined, key: Key) =>
  !!str && !key.ctrl && !key.meta && str.length >= 1 && !/[\x00-\x1f\x7f]/.test(str);

// ── text ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TextOptions {
  label: string;
  instruction: string;
  prefill?: string;
  /** Where the prefill came from, shown beside it ("from your MCP server"). */
  prefillSource?: string;
  examples?: string[];
  initial?: string;
  optional?: boolean;
  /** Soft length guide: a counter, red past the limit. */
  maxLength?: number;
  /** Error message, or null when fine. */
  validate?: (v: string) => string | null;
  /** Live note under the field (e.g. "✓ live"), recomputed on every redraw. */
  note?: () => string | null;
  /** j / ; on an empty field go back / skip (default true). Off for fields embedded in another widget. */
  nav?: boolean;
}

export const NAV_HINT = "j back · ; skip";

export class TextInput implements Widget<string | Nav> {
  value: string;
  pos: number;
  private error: string | null = null;
  private flash: { text: string; until: number } | null = null;
  private lastKey = Date.now();
  private timer?: NodeJS.Timeout;

  get label() { return this.o.label; }

  constructor(private o: TextOptions) {
    this.value = o.initial ?? "";
    this.pos = this.value.length;
  }

  private get prefill() { return this.o.prefill?.trim() || undefined; }

  attach(redraw: () => void) {
    // Repaint on a clock only for what changes by itself: the examples fade-in and flash messages.
    this.timer = setInterval(() => {
      const idle = Date.now() - this.lastKey;
      const fading = !this.value && this.o.examples?.length && idle >= IDLE_MS && idle <= IDLE_MS + FADE.length * 150 + 300;
      const cycling = !this.value && (this.o.examples?.length ?? 0) > 1 && idle > IDLE_MS;
      const flashing = this.flash && Date.now() <= this.flash.until + 300;
      if (fading || cycling || flashing) redraw();
    }, 150);
  }
  detach() { clearInterval(this.timer); }

  private say(text: string) { this.flash = { text, until: Date.now() + 1500 }; }

  render(): Frame {
    const p = this.prefill;
    const width = Math.max(20, (process.stdout.columns ?? 80) - 1);
    const lines: string[] = [];
    const instructionInField = !this.value && !p;
    lines.push(`${style.cyan("?")} ${style.bold(this.o.label)}${instructionInField ? "" : `  ${this.o.instruction}`}${this.o.optional ? style.dim(" (optional)") : ""}`);

    // Field, windowed so the cursor stays visible on long values.
    const room = width - PROMPT.length - 1;
    let start = 0;
    if (this.value.length > room) start = Math.max(0, Math.min(this.pos - Math.floor(room * 0.7), this.value.length - room));
    const shown = this.value.slice(start, start + room);
    const clipped = start > 0 ? "…" + shown.slice(1) : shown;
    let field: string;
    if (instructionInField) field = style.dim(this.o.instruction);
    else if (!this.value && p) field = style.dim(p);
    else if (p && this.pos === this.value.length && p.length > this.value.length && p.toLowerCase().startsWith(this.value.toLowerCase())) field = clipped + style.dim(p.slice(this.value.length));
    else field = clipped;
    lines.push(PROMPT + field);
    const cursorCol = PROMPT.length + (this.pos - start);

    // Hint line: the suggestion is never lost.
    if (p) {
      const src = this.o.prefillSource ? style.dim(` (${this.o.prefillSource})`) : "";
      if (!this.value) lines.push(style.dim(`  Tab fills the suggestion · Enter submits · ^Y copies it${this.o.nav === false ? "" : " · " + NAV_HINT}`) + src);
      else if (this.value !== p) lines.push(style.dim("  suggested: ") + p + src + style.dim(" · ↑ restore · ^Y copy"));
      else lines.push(style.dim("  suggestion filled") + src + style.dim(" · ^K copy · Esc clear"));
    }

    const notes: string[] = [];
    if (this.o.maxLength && this.value) {
      const n = this.value.length; const t = `${n}/${this.o.maxLength}`;
      notes.push(n > this.o.maxLength ? style.red(t) : style.dim(t));
    }
    const note = this.o.note?.();
    if (note) notes.push(note);
    if (this.flash && Date.now() <= this.flash.until) notes.push(style.green(this.flash.text));
    if (this.error) notes.push(style.red(this.error));
    if (!p && !this.value && this.o.nav !== false && !notes.length) notes.push(style.dim(NAV_HINT));
    if (notes.length) lines.push("  " + notes.join(style.dim(" · ")));

    // Examples: empty field, idle, fading in, italic, secondary.
    const idle = Date.now() - this.lastKey;
    if (!this.value && this.o.examples?.length && idle >= IDLE_MS) {
      const step = Math.min(FADE.length - 1, Math.floor((idle - IDLE_MS) / 150));
      const ex = this.o.examples[Math.floor((idle - IDLE_MS) / 5000) % this.o.examples.length];
      lines.push(style.grey(FADE[step])(style.italic(`  e.g. ${ex}`)));
    }
    return { lines, cursor: { row: 1, col: cursorCol } };
  }

  onKey(str: string | undefined, key: Key): { done: string | Nav } | void {
    this.lastKey = Date.now();
    this.error = null;
    const p = this.prefill;
    if (!this.value && this.o.nav !== false && !key.ctrl && !key.meta) {
      if (str === "j") return { done: BACK };
      if (str === ";") return { done: SKIP };
    }
    const set = (v: string, pos = v.length) => { this.value = v; this.pos = pos; };
    switch (key.name) {
      case "return": case "enter": {
        const v = this.value.trim();
        if (!v && !this.o.optional) { this.error = p ? "Tab fills the suggestion, or type your own" : "required"; return; }
        const err = v ? this.o.validate?.(v) ?? null : null;
        if (err) { this.error = err; return; }
        return { done: v };
      }
      case "tab": if (p && this.value !== p) set(p); return;
      case "up": if (p) set(p); return;
      case "escape": set(""); return;
      case "left": this.pos = Math.max(0, this.pos - 1); return;
      case "right": {
        if (this.pos === this.value.length && p && p.toLowerCase().startsWith(this.value.toLowerCase()) && p.length > this.value.length) set(this.value + p[this.value.length]);
        else this.pos = Math.min(this.value.length, this.pos + 1);
        return;
      }
      case "home": this.pos = 0; return;
      case "end": this.pos = this.value.length; return;
      case "backspace": if (this.pos > 0) set(this.value.slice(0, this.pos - 1) + this.value.slice(this.pos), this.pos - 1); return;
      case "delete": set(this.value.slice(0, this.pos) + this.value.slice(this.pos + 1), this.pos); return;
    }
    if (key.ctrl) {
      if (key.name === "a") this.pos = 0;
      else if (key.name === "e") this.pos = this.value.length;
      else if (key.name === "u") set(this.value.slice(this.pos), 0);
      else if (key.name === "w") { const left = this.value.slice(0, this.pos).replace(/\S+\s*$/, ""); set(left + this.value.slice(this.pos), left.length); }
      else if (key.name === "y") { const t = p ?? this.value; if (t) { copyToClipboard(t); this.say(`copied: ${t.length > 40 ? t.slice(0, 40) + "…" : t}`); } }
      else if (key.name === "k") { if (this.value) { copyToClipboard(this.value); this.say("copied what you typed"); } }
      return;
    }
    if (printable(str, key)) set(this.value.slice(0, this.pos) + str!.replace(/[\r\n]+/g, " ") + this.value.slice(this.pos), this.pos + str!.length);
  }

  summary(v: string | Nav) {
    return `${style.green("✔")} ${style.bold(this.o.label)} ${typeof v === "string" && v ? style.cyan(v) : style.dim("(empty)")}`;
  }
}

// ── single choice ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface Choice<T> { value: T; label: string; description?: string }

export class Select<T> implements Widget<T | Nav> {
  private i: number;
  get label() { return this.o.label; }
  constructor(private o: { label: string; instruction: string; choices: Choice<T>[]; initial?: T; prefillSource?: string }) {
    const at = o.choices.findIndex((c) => c.value === o.initial);
    this.i = at >= 0 ? at : 0;
  }
  render(): Frame {
    const w = Math.max(...this.o.choices.map((c) => c.label.length));
    const lines = [`${style.cyan("?")} ${style.bold(this.o.label)}  ${this.o.instruction}`];
    this.o.choices.forEach((c, i) => {
      const on = i === this.i;
      const pre = on && this.o.initial === c.value && this.o.prefillSource ? style.dim(` (${this.o.prefillSource})`) : "";
      lines.push(`${on ? style.cyan("❯ ◉") : "  ○"} ${on ? style.bold(c.label.padEnd(w)) : c.label.padEnd(w)}  ${style.dim(c.description ?? "")}${pre}`);
    });
    lines.push(style.dim(`  ↑/↓ or 1–9 to choose · Enter confirms · ${NAV_HINT}`));
    return { lines, cursor: { row: 1 + this.i, col: 2 } };
  }
  onKey(str: string | undefined, key: Key): { done: T | Nav } | void {
    const n = this.o.choices.length;
    if (str === "j") return { done: BACK };
    if (str === ";") return { done: SKIP };
    if (key.name === "up") this.i = (this.i - 1 + n) % n;
    else if (key.name === "down") this.i = (this.i + 1) % n;
    else if (key.name === "return" || key.name === "enter") return { done: this.o.choices[this.i].value };
    else if (str && /^[1-9]$/.test(str) && Number(str) <= n) this.i = Number(str) - 1;
  }
  summary(v: T | Nav) { return `${style.green("✔")} ${style.bold(this.o.label)} ${style.cyan(this.o.choices.find((c) => c.value === v)?.label ?? String(v))}`; }
}

// ── multiple choice ───────────────────────────────────────────────────────────────────────────────────────────────
export class Checkbox<T> implements Widget<T[] | Nav> {
  private i = 0;
  get label() { return this.o.label; }
  private on: Set<T>;
  private error: string | null = null;
  constructor(private o: { label: string; instruction: string; choices: Choice<T>[]; initial?: T[]; min?: number }) {
    this.on = new Set(o.initial ?? []);
  }
  render(): Frame {
    const w = Math.max(...this.o.choices.map((c) => c.label.length));
    const lines = [`${style.cyan("?")} ${style.bold(this.o.label)}  ${this.o.instruction}`];
    this.o.choices.forEach((c, i) => {
      const box = this.on.has(c.value) ? style.green("◼") : "◻";
      lines.push(`${i === this.i ? style.cyan("❯") : " "} ${box} ${i === this.i ? style.bold(c.label.padEnd(w)) : c.label.padEnd(w)}  ${style.dim(c.description ?? "")}`);
    });
    lines.push(this.error ? "  " + style.red(this.error) : style.dim(`  Space toggles · a all/none · Enter confirms · ${NAV_HINT}`));
    return { lines, cursor: { row: 1 + this.i, col: 2 } };
  }
  onKey(str: string | undefined, key: Key): { done: T[] | Nav } | void {
    this.error = null;
    if (str === "j") return { done: BACK };
    if (str === ";") return { done: SKIP };
    const n = this.o.choices.length;
    const cur = this.o.choices[this.i].value;
    if (key.name === "up") this.i = (this.i - 1 + n) % n;
    else if (key.name === "down") this.i = (this.i + 1) % n;
    else if (key.name === "space" || str === " ") { if (this.on.has(cur)) this.on.delete(cur); else this.on.add(cur); }
    else if (str === "a") { if (this.on.size === n) this.on.clear(); else this.o.choices.forEach((c) => this.on.add(c.value)); }
    else if (key.name === "return" || key.name === "enter") {
      if (this.on.size < (this.o.min ?? 0)) { this.error = `choose at least ${this.o.min}`; return; }
      return { done: this.o.choices.filter((c) => this.on.has(c.value)).map((c) => c.value) };
    }
  }
  summary(v: T[] | Nav) {
    if (!Array.isArray(v)) return ""; return `${style.green("✔")} ${style.bold(this.o.label)} ${v.length ? style.cyan(this.o.choices.filter((c) => v.includes(c.value)).map((c) => c.label).join(", ")) : style.dim("(none)")}`; }
}

