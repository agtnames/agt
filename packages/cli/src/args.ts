/** Argument parsing: positionals, `--flag value`, `--flag=value`, and declared booleans. Unknown flags are errors. */

export class UsageError extends Error { constructor(m: string) { super(m); this.name = "UsageError"; } }

export const BOOLEAN_FLAGS = ["dry-run", "json", "yes", "no-open", "no-records", "no-endpoints", "skip-live-check", "template", "no-probe", "help", "version"] as const;
export const VALUE_FLAGS = ["network", "rpc", "site", "signer", "key-env", "keyfile", "years", "to", "host", "out", "mcp", "a2a", "http", "ws", "wallet", "addr", "manifest", "timeout", "shell", "port"] as const;

export interface Parsed { positionals: string[]; flags: Record<string, string>; bools: Set<string> }

export function parseArgs(argv: string[]): Parsed {
  const positionals: string[] = []; const flags: Record<string, string> = {}; const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") { bools.add("help"); continue; }
    if (!a.startsWith("--")) { positionals.push(a); continue; }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq > 0 ? eq : undefined);
    if ((BOOLEAN_FLAGS as readonly string[]).includes(name)) {
      if (eq > 0) throw new UsageError(`--${name} takes no value`);
      bools.add(name); continue;
    }
    if (!(VALUE_FLAGS as readonly string[]).includes(name)) throw new UsageError(`unknown option --${name}`);
    const value = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (value === undefined || (eq < 0 && value.startsWith("--"))) throw new UsageError(`--${name} needs a value`);
    flags[name] = value;
  }
  return { positionals, flags, bools };
}

export function parseYears(v: string | undefined): number {
  if (v === undefined) return 1;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new UsageError("--years must be a whole number from 1 to 10");
  return n;
}

export function parseAddressFlag(v: string | undefined, flag: string): `0x${string}` | undefined {
  if (v === undefined) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new UsageError(`--${flag} must be a 0x address (40 hex characters)${/^0x[0-9a-fA-F]{64}$/.test(v) ? "; that looks like a private key, never pass one on the command line" : ""}`);
  return v as `0x${string}`;
}

export function parseHttpsFlag(v: string | undefined, flag: string): string | undefined {
  if (v === undefined) return undefined;
  let u: URL;
  try { u = new URL(v); } catch { throw new UsageError(`--${flag} is not a URL: ${v}`); }
  if (u.protocol !== "https:" && !(flag === "ws" && u.protocol === "wss:")) throw new UsageError(`--${flag} must be an https:// URL`);
  return v;
}
