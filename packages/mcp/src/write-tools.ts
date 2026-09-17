/**
 * countersign write tools (D-025 v2). Registered only when AGT_SESSION_PASSPHRASE is set, so the default server
 * stays read-only. The session key lives in AGT_SESSION_DIR, encrypted; the owner signs a grant for its address;
 * every write is redeemed through the DelegationManager and bounded by the grant's caveats on-chain.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ACTIONS, describeGrant, grantStatus, redeem, RedeemError, GrantError, type ActionArgs, type GrantV1 } from "@agtnames/countersign";
import { SessionStore, type SessionConfig } from "./session.js";
import { bounded, checkName, McpToolError, type ErrorCode } from "./server.js";

export const WRITE_TOOL_NAMES = [
  "agt_session_new", "agt_session_import", "agt_session_status", "agt_session_forget",
  "agt_set_text", "agt_set_addr", "agt_set_endpoint", "agt_set_manifest_uri", "agt_set_wallet",
] as const;

export type WriteErrorCode = ErrorCode | "no_session" | "grant_refused" | "grant_expired" | "caveat_violation" | "insufficient_gas" | "wrong_session" | "unknown_name" | "action_not_granted";

const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
const LOCAL: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const LOCAL_READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export const WRITE_NOTICE = "Writes are bounded by the grant's on-chain caveats: only the listed names, only the listed record setters, no value, until the expiry, at most maxCalls per name. The owner revokes everything by bumping their NonceEnforcer nonce.";

const ok = (v: unknown): CallToolResult => ({ content: [{ type: "text", text: bounded(v) }] });
const err = (code: WriteErrorCode, message: string): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }], isError: true });

function classify(e: unknown): CallToolResult {
  if (e instanceof RedeemError) return err(e.code === "rpc_error" ? "rpc_error" : e.code, e.message);
  if (e instanceof GrantError) return err("grant_refused", `${e.code}: ${e.message}`);
  if (e instanceof McpToolError) return err(e.code, e.message);
  const m = e instanceof Error ? e.message : String(e);
  if (/no session key/i.test(m)) return err("no_session", m);
  if (/grant refused|not this session|delegate/i.test(m)) return err("grant_refused", m);
  return err("internal", m.slice(0, 300));
}

export interface WriteDeps {
  /** Injected in tests: replaces the on-chain redemption. */
  redeem?: typeof redeem;
  status?: typeof grantStatus;
  rpcUrl?: string;
  now?: () => number;
}

export function registerWriteTools(server: McpServer, cfg: SessionConfig, deps: WriteDeps = {}): void {
  const store = new SessionStore(cfg);
  const doRedeem = deps.redeem ?? redeem;
  const doStatus = deps.status ?? grantStatus;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  const nameSchema = z.string().min(1).max(70).describe("A .agt name covered by the imported grant");
  const loadGrant = (): GrantV1 => {
    const g = store.grant();
    if (!g) throw new McpToolError("misconfigured" as ErrorCode, "no grant imported; call agt_session_import with a grant the owner signed for this session");
    if (now() >= g.notAfter) throw new RedeemError("caveat_violation", `grant expired at ${new Date(g.notAfter * 1000).toISOString()}; ask the owner for a new one`);
    return g;
  };
  const write = async (name: string, args: ActionArgs) => {
    const g = loadGrant();
    const n = checkName(name);
    const r = await doRedeem(g, n, args, { session: store.privateKey(), rpcUrl: deps.rpcUrl });
    return { name: n, action: ACTIONS[args.action].functionName, txHash: r.hash, blockNumber: r.blockNumber.toString(), chainId: g.chainId, notice: WRITE_NOTICE };
  };
  const guarded = <A>(fn: (a: A) => Promise<unknown>) => async (a: A): Promise<CallToolResult> => { try { return ok(await fn(a)); } catch (e) { return classify(e); } };

  server.registerTool("agt_session_new", {
    title: "Create the local session key",
    description: "Create (or show) this machine's countersign session key and return its address. Give the address to the name owner: they sign a grant for it (names, record setters, expiry, call count) and you import that grant with agt_session_import. The private key never leaves this machine.",
    inputSchema: {},
    annotations: LOCAL,
  }, guarded(async () => {
    const { address, created } = store.ensureKey();
    return { sessionAddress: address, created, next: `Owner: build a grant for delegate ${address} (agt-countersign build --session ${address} …), sign it, and paste the JSON into agt_session_import. Fund ${address} with a little POL for gas.` };
  }));

  server.registerTool("agt_session_import", {
    title: "Import a signed grant",
    description: "Validate and store a grant the owner signed for this session. Refuses a grant for another session, an expired grant, or one whose caveats do not match its summary. Returns the plain-language mandate the chain will enforce.",
    inputSchema: { grant: z.string().min(2).max(64 * 1024).describe("Grant JSON as produced by agt-countersign build (or the owner's wallet flow)") },
    annotations: LOCAL,
  }, guarded(async ({ grant }) => {
    const { grant: g, description } = await store.importGrant(grant, now());
    return { imported: true, grantHash: g.hash, names: g.names.map((n) => n.name), actions: g.actions, notAfter: new Date(g.notAfter * 1000).toISOString(), maxCallsPerName: g.maxCalls, mandate: description.summary, notice: WRITE_NOTICE };
  }));

  server.registerTool("agt_session_status", {
    title: "Session and grant status",
    description: "Show the session address, whether a grant is imported, and (from the chain) calls used per name, expiry, whether the owner has revoked, and the session's gas balance.",
    inputSchema: {},
    annotations: LOCAL_READ,
  }, guarded(async () => {
    const address = store.address();
    const g = store.grant();
    if (!g) return { sessionAddress: address, grant: null, hint: address ? "no grant imported yet" : "no session key yet; call agt_session_new" };
    const d = await describeGrant(g, { now: now(), verifySignatures: false });
    const s = await doStatus(g, { rpcUrl: deps.rpcUrl, now: now() });
    return { sessionAddress: address, grantHash: g.hash, mandate: d.summary, onchain: s };
  }));

  server.registerTool("agt_session_forget", {
    title: "Forget the local grant",
    description: "Delete the imported grant from this machine (and the session key too if deleteKey is true). This is local housekeeping only: to revoke on-chain, the owner bumps their NonceEnforcer nonce or disables the delegation.",
    inputSchema: { deleteKey: z.boolean().default(false).describe("Also delete the session private key") },
    annotations: LOCAL,
  }, guarded(async ({ deleteKey }) => { store.forget({ key: deleteKey }); return { forgotten: true, keyDeleted: deleteKey, reminder: "On-chain revocation is the owner's: bump the NonceEnforcer nonce (revoke all) or DelegationManager.disableDelegation (one grant)." }; }));

  server.registerTool("agt_set_text", {
    title: "Set a text record (under the grant)",
    description: `Write a text record (url, description, avatar, com.twitter, …) on a granted name. ${ACTIONS.text.describe}. Redeemed through the owner's delegation; reverts if the name, key type or call budget is outside the grant.`,
    inputSchema: { name: nameSchema, key: z.string().min(1).max(64), value: z.string().max(2048) },
    annotations: WRITE,
  }, guarded(({ name, key, value }) => write(name, { action: "text", key, value })));

  server.registerTool("agt_set_addr", {
    title: "Set the address record (under the grant)",
    description: `Write the primary address record on a granted name. ${ACTIONS.addr.describe}.`,
    inputSchema: { name: nameSchema, address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) },
    annotations: WRITE,
  }, guarded(({ name, address }) => write(name, { action: "addr", address: address as `0x${string}` })));

  server.registerTool("agt_set_endpoint", {
    title: "Set an agent endpoint (under the grant)",
    description: `Write the endpoint URL for a protocol on a granted name. ${ACTIONS.endpoint.describe}.`,
    inputSchema: { name: nameSchema, protocol: z.enum(["mcp", "a2a", "http", "ws"]), url: z.string().url().max(2048) },
    annotations: WRITE,
  }, guarded(({ name, protocol, url }) => write(name, { action: "endpoint", protocol, url })));

  server.registerTool("agt_set_manifest_uri", {
    title: "Point the name at a manifest URI (under the grant)",
    description: `Write the on-chain manifest pointer on a granted name. ${ACTIONS.manifest.describe}. The manifest document itself must still be signed by the owner's key; this tool only moves the pointer.`,
    inputSchema: { name: nameSchema, uri: z.string().min(1).max(2048) },
    annotations: WRITE,
  }, guarded(({ name, uri }) => write(name, { action: "manifest", uri })));

  server.registerTool("agt_set_wallet", {
    title: "Set the agent wallet record (under the grant)",
    description: `Write the agent wallet record on a granted name. ${ACTIONS.wallet.describe}.`,
    inputSchema: { name: nameSchema, wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/) },
    annotations: WRITE,
  }, guarded(({ name, wallet }) => write(name, { action: "wallet", wallet: wallet as `0x${string}` })));
}
