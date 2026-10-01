/**
 * Endpoints: one list, one URL input per protocol row.
 *
 *   list   ↑/↓ move between rows · Tab focuses the row's URL input · Space toggles a row with a URL · Enter continues
 *          to the next step with every ticked row · j back · ; skip
 *   input  the field shows the format it needs (https://…, wss://…) until you type; a known URL is a prefill (Tab
 *          fills). Enter saves the row, ticks it, starts reading the endpoint in the background, and moves focus to
 *          the next row. Enter on an empty input unticks the row. Esc on an empty input returns to the list.
 *
 * So the fast path is Tab, type, Enter for each row, then Enter again to move on.
 */
import { TextInput } from "./widgets.js";
import { BACK, SKIP, style, type Frame, type Key, type Nav, type Widget } from "./tui.js";

export interface EndpointRow {
  protocol: string;
  label: string;
  /** Format shown in the empty input, e.g. "https://… (your MCP endpoint URL)". */
  format: string;
  url: string;
  on: boolean;
  prefill?: string;
  prefillSource?: string;
}

export interface EndpointsOptions {
  label: string;
  rows: EndpointRow[];
  validate: (protocol: string, url: string) => string | null;
  /** Live status for a saved row ("✓ live · 3 tools"). */
  status: (protocol: string, url: string) => string | null;
  /** Called when a row's URL is saved, so it can be read in the background. */
  onSave: (protocol: string, url: string) => void;
  /** Background results arrive: redraw. Returns an unsubscribe. */
  onChange: (cb: () => void) => () => void;
}

const LABEL_W = 10;

export class EndpointsInput implements Widget<Record<string, string> | Nav> {
  private i = 0;
  private editor: TextInput | null = null;
  private error: string | null = null;
  private off?: () => void;
  get label() { return this.o.label; }

  constructor(private o: EndpointsOptions) {}

  attach(redraw: () => void) { this.off = this.o.onChange(redraw); }
  detach() { this.off?.(); this.editor?.detach(); }

  private row() { return this.o.rows[this.i]; }

  /** A URL next to one already entered, as a prefill for an empty row: https://host/mcp → https://host/a2a. */
  private derived(r: EndpointRow): { url: string; source: string } | undefined {
    const other = this.o.rows.find((x) => x !== r && x.on && x.url);
    if (!other) return undefined;
    try {
      const origin = new URL(other.url).origin;
      return { url: r.protocol === "ws" ? `${origin.replace(/^https:/, "wss:")}/ws` : `${origin}/${r.protocol}`, source: `next to your ${other.label} endpoint` };
    } catch { return undefined; }
  }

  private openEditor() {
    const r = this.row();
    const d = r.url ? undefined : r.prefill ? { url: r.prefill, source: r.prefillSource ?? "" } : this.derived(r);
    this.editor = new TextInput({
      label: r.label, instruction: r.format, initial: r.url || undefined,
      prefill: d?.url, prefillSource: d?.source || undefined,
      optional: true, nav: false,
      validate: (v) => this.o.validate(r.protocol, v),
    });
  }

  render(): Frame {
    const lines = [`${style.cyan("?")} ${style.bold(this.o.label)}  Add the URL for each protocol your agent serves`];
    let cursor = { row: 1, col: 2 };
    this.o.rows.forEach((r, idx) => {
      const focused = idx === this.i;
      const box = r.on ? style.green("[x]") : "[ ]";
      const name = (focused ? style.bold(r.label.padEnd(LABEL_W)) : r.label.padEnd(LABEL_W));
      const ptr = focused ? style.cyan("❯") : " ";
      if (focused && this.editor) {
        // The row's input, inline: the editor's field line and its hint, indented under the row.
        const f = this.editor.render();
        const field = f.lines[1].replace(/^› /, "");
        const prefix = `${ptr} ${box} ${name} `;
        lines.push(prefix + field);
        cursor = { row: lines.length - 1, col: prefix.replace(/\x1b\[[0-9;]*m/g, "").length + (f.cursor.col - 2) };
        for (const extra of f.lines.slice(2)) lines.push("       " + extra.replace(/^ {2}/, ""));
        return;
      }
      const status = r.on && r.url ? this.o.status(r.protocol, r.url) : null;
      lines.push(`${ptr} ${box} ${name} ${r.url ? r.url : style.dim(r.format)}${status ? "  " + status : ""}`);
      if (focused) cursor = { row: lines.length - 1, col: 2 };
    });
    if (this.error) lines.push("  " + style.red(this.error));
    lines.push(style.dim(this.editor
      ? "  Enter saves and moves to the next row · Tab fills the suggestion · Esc back to the list"
      : "  ↑/↓ move · Tab edit the URL · Space tick/untick · Enter continue · j back · ; skip"));
    return { lines, cursor };
  }

  onKey(str: string | undefined, key: Key): { done: Record<string, string> | Nav } | void {
    this.error = null;
    const r = this.row();
    if (this.editor) {
      if (key.name === "escape" && !this.editor.value) { this.editor.detach(); this.editor = null; return; }
      const res = this.editor.onKey(str, key);
      if (res && typeof res.done === "string") {
        const v = res.done;
        r.url = v;
        r.on = !!v;
        if (v) this.o.onSave(r.protocol, v);
        this.editor.detach();
        this.editor = null;
        this.i = Math.min(this.o.rows.length - 1, this.i + 1);
      }
      return;
    }
    const n = this.o.rows.length;
    if (str === "j") return { done: BACK };
    if (str === ";") return { done: SKIP };
    if (key.name === "up") { this.i = (this.i - 1 + n) % n; return; }
    if (key.name === "down") { this.i = (this.i + 1) % n; return; }
    if (key.name === "tab" || key.name === "right") { this.openEditor(); return; }
    if (key.name === "space" || str === " ") { if (r.url) r.on = !r.on; else this.openEditor(); return; }
    if (key.name === "return" || key.name === "enter") {
      const chosen = this.o.rows.filter((x) => x.on && x.url);
      if (!chosen.length) { this.error = "Add at least one URL (Tab to edit a row), or ; to skip"; return; }
      return { done: Object.fromEntries(chosen.map((x) => [x.protocol, x.url])) };
    }
  }

  summary(v: Record<string, string> | Nav) {
    if (typeof v !== "object") return "";
    return `${style.green("✔")} ${style.bold(this.o.label)} ${style.cyan(Object.entries(v).map(([p, u]) => `${p} ${u}`).join(" · "))}`;
  }
}
