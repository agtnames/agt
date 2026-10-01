/**
 * The terminal layer for interactive prompts (RATIONALE R-1). A widget renders a block of lines plus a cursor
 * position; the runner redraws the whole block on every change and parks the cursor exactly there, so faint text can
 * sit after the cursor (RATIONALE R-5). Lines are cut to the terminal width so nothing wraps and breaks the redraw.
 */
import { spawn } from "node:child_process";
import { emitKeypressEvents } from "node:readline";

export interface Key { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }

export interface Frame { lines: string[]; cursor: { row: number; col: number } }

export interface Widget<T> {
  render(): Frame;
  /** Return { done: value } to finish; anything else redraws. */
  onKey(str: string | undefined, key: Key): { done: T } | void | Promise<{ done: T } | void>;
  /** The one line left on screen after the widget finishes. */
  summary(value: T): string;
  /** Shown when the step is skipped. */
  label?: string;
  /** Called with a redraw function, for widgets that change on their own (timers, background data). */
  attach?(redraw: () => void): void;
  detach?(): void;
}

export class CancelledError extends Error { constructor() { super("cancelled"); this.name = "CancelledError"; } }

/** Step navigation a widget can return instead of a value: `j` goes back a step, `;` skips it. */
export const BACK: unique symbol = Symbol("back");
export const SKIP: unique symbol = Symbol("skip");
export type Nav = typeof BACK | typeof SKIP;
export const isNav = (v: unknown): v is Nav => v === BACK || v === SKIP;

/** Erase the last `n` printed lines (a finished step's summary) so a step re-opens in place. */
export function eraseLines(n: number): void {
  if (n > 0 && process.stdout.isTTY) process.stdout.write(`\x1b[${n}A\r\x1b[J`);
}

// ── styles ────────────────────────────────────────────────────────────────────────────────────────────────────────
const color = process.env.NO_COLOR === undefined && process.stdout.isTTY;
const wrap = (open: string, close: string) => (s: string) => (color ? `\x1b[${open}m${s}\x1b[${close}m` : s);
export const style = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  italic: wrap("3", "23"),
  cyan: wrap("36", "39"),
  green: wrap("32", "39"),
  red: wrap("31", "39"),
  yellow: wrap("33", "39"),
  inverse: wrap("7", "27"),
  /** A grey from the 256-colour ramp, 232 (black) … 255 (white); used for the examples fade. */
  grey: (level: number) => (s: string) => (color ? `\x1b[38;5;${level}m${s}\x1b[39m` : s),
};

const ANSI = /\x1b\[[0-9;]*m|\x1b\]52;[^\x07]*\x07/g;
export const visibleLength = (s: string) => s.replace(ANSI, "").length;

/** Cut a styled line to `width` visible characters, keeping escape codes intact. */
export function truncate(s: string, width: number): string {
  if (visibleLength(s) <= width) return s;
  let out = ""; let seen = 0; let i = 0;
  while (i < s.length && seen < width - 1) {
    const m = s[i] === "\x1b" ? /^\x1b\[[0-9;]*m/.exec(s.slice(i)) : null;
    if (m) { out += m[0]; i += m[0].length; continue; }
    out += s[i]; seen++; i++;
  }
  return out + "…" + (color ? "\x1b[0m" : "");
}

// ── runner ────────────────────────────────────────────────────────────────────────────────────────────────────────
let keypressReady = false;

export function isInteractive(): boolean {
  return !!(process.stdin.isTTY && process.stdout.isTTY);
}

export function run<T>(widget: Widget<T | Nav>): Promise<T | Nav> {
  const out = process.stdout;
  const stdin = process.stdin;
  if (!keypressReady) { emitKeypressEvents(stdin); keypressReady = true; }
  let cursorRow = 0;   // row the cursor sits on, within the block
  let finished = false;

  const draw = () => {
    if (finished) return;
    const width = Math.max(20, (out.columns ?? 80) - 1);
    const f = widget.render();
    const lines = f.lines.map((l) => truncate(l, width));
    let s = "\x1b[?25l";                                         // hide cursor while drawing
    if (cursorRow > 0) s += `\x1b[${cursorRow}A`;
    s += "\r\x1b[J" + lines.join("\n");
    const up = lines.length - 1 - f.cursor.row;
    if (up > 0) s += `\x1b[${up}A`;
    s += "\r" + (f.cursor.col > 0 ? `\x1b[${Math.min(f.cursor.col, width)}C` : "") + "\x1b[?25h";
    out.write(s);
    cursorRow = f.cursor.row;
  };

  return new Promise<T | Nav>((resolve, reject) => {
    const finish = (err: Error | null, value?: T | Nav) => {
      if (finished) return;
      widget.detach?.();
      stdin.removeListener("keypress", onKey);
      out.removeListener("resize", draw);
      // Replace the block with the one-line summary.
      let s = cursorRow > 0 ? `\x1b[${cursorRow}A` : "";
      const width = Math.max(20, (out.columns ?? 80) - 1);
      // Back: leave nothing, the previous step re-opens where this one was. Skip: one dim line. Done: the summary.
      if (value === BACK && !err) s += "\r\x1b[J";
      else s += "\r\x1b[J" + truncate(err ? style.dim("✗ cancelled") : value === SKIP ? style.dim(`↷ ${widget.label ?? "step"} skipped`) : widget.summary(value as T), width) + "\n";
      out.write(s);
      finished = true;
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      if (err) reject(err); else resolve(value as T | Nav);
    };
    const onKey = async (str: string | undefined, key: Key = {}) => {
      if (key.ctrl && key.name === "c") return finish(new CancelledError());
      try {
        const r = await widget.onKey(str, key);
        if (r && "done" in r) return finish(null, r.done);
        draw();
      } catch (e) { finish(e as Error); }
    };
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKey);
    out.on("resize", draw);
    widget.attach?.(draw);
    draw();
  });
}

// ── clipboard ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Copy text: OSC 52 (understood by Windows Terminal, iTerm2, kitty, most modern terminals, and over SSH) plus the
 * platform's clipboard tool. Either one is enough; failures are silent.
 */
export function copyToClipboard(text: string): void {
  if (process.stdout.isTTY) process.stdout.write(`\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
  const [cmd, args] = process.platform === "win32" ? ["clip", []]
    : process.platform === "darwin" ? ["pbcopy", []]
    : process.env.WAYLAND_DISPLAY ? ["wl-copy", []] : ["xclip", ["-selection", "clipboard"]];
  try {
    const p = spawn(cmd as string, args as string[], { stdio: ["pipe", "ignore", "ignore"] });
    p.on("error", () => {});
    p.stdin.on("error", () => {});
    p.stdin.end(text);
  } catch { /* OSC 52 already sent */ }
}
