#!/usr/bin/env node
/**
 * @agtnames/mcp — .agt for agents. Works with any MCP-compatible client (Claude Code, Cursor, custom agents).
 *
 * Entry point: `--version` / `--help` fast paths, then config → server → stdio. Tool definitions live in
 * server.ts, configuration in config.ts. stdout carries protocol frames only; diagnostics go to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, HELP, VERSION, loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const argv = process.argv.slice(2);
if (argv.includes("--version") || argv.includes("-v")) { process.stdout.write(VERSION + "\n"); process.exit(0); }
if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(HELP); process.exit(0); }

let cfg;
try {
  cfg = loadConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) { console.error(`agt-mcp: ${e.message}`); process.exit(2); }
  throw e;
}

const server = buildServer(cfg);
const transport = new StdioServerTransport();

let closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  setTimeout(() => process.exit(code), 1000).unref(); // never hang on a stuck close
  try { await server.close(); } catch { /* already gone */ }
  process.exit(code);
}

// A client that goes away closes our stdin; that is the reliable signal on every platform (Windows has no SIGTERM).
process.stdin.on("end", () => void shutdown(0));
process.stdin.on("close", () => void shutdown(0));
transport.onclose = () => void shutdown(0);
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

server.server.oninitialized = () => console.error(`agt-mcp ${VERSION} ready (chain ${cfg.chain})`);
await server.connect(transport);
