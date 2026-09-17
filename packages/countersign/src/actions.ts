/**
 * Owner actions a countersign grant may cover. All of them are AGTResolver setters gated by `authorised(node)`,
 * carry no value, and take the name's node as their first argument (which is what the per-name calldata pin binds).
 *
 * Deliberately absent: anything on the registry (transfers, approvals, setResolver), anything on the controller
 * (register/renew move value and need no owner authority), `multicall`, and manifest JSON signing.
 */
import { parseAbi, toFunctionSelector, type Abi, type AbiFunction, type Hex } from "viem";

export const resolverAbi = parseAbi([
  "function setAddr(bytes32 node, address a)",
  "function setText(bytes32 node, string key, string value)",
  "function setContenthash(bytes32 node, bytes hash)",
  "function setAgentManifest(bytes32 node, string uri)",
  "function setAgentEndpoint(bytes32 node, string protocol, string url)",
  "function setAgentWallet(bytes32 node, address wallet)",
  "function setAgentKey(bytes32 node, string purpose, bytes pubkey, uint32 version, bool revoked)",
  "function addr(bytes32 node) view returns (address)",
  "function text(bytes32 node, string key) view returns (string)",
  "function agentManifest(bytes32 node) view returns (string)",
  "function agentEndpoint(bytes32 node, string protocol) view returns (string)",
  "function agentWallet(bytes32 node) view returns (address)",
]) satisfies Abi;

export type ActionId = "text" | "addr" | "contenthash" | "manifest" | "endpoint" | "wallet" | "key";

export interface ActionDef {
  id: ActionId;
  functionName: "setText" | "setAddr" | "setContenthash" | "setAgentManifest" | "setAgentEndpoint" | "setAgentWallet" | "setAgentKey";
  selector: Hex;
  /** Plain-language description used by describeGrant and the MCP tool descriptions. */
  describe: string;
}

const fn = (name: ActionDef["functionName"]): AbiFunction =>
  (resolverAbi as readonly AbiFunction[]).find((x) => x.type === "function" && x.name === name && x.inputs.length > 1)!;

const def = (id: ActionId, functionName: ActionDef["functionName"], describe: string): ActionDef =>
  ({ id, functionName, selector: toFunctionSelector(fn(functionName)), describe });

export const ACTIONS: Record<ActionId, ActionDef> = {
  text: def("text", "setText", "set a text record (url, description, avatar, com.*)"),
  addr: def("addr", "setAddr", "set the payment / identity address record"),
  contenthash: def("contenthash", "setContenthash", "set the contenthash record"),
  manifest: def("manifest", "setAgentManifest", "point the name at a manifest URI (the manifest itself is still signed by the owner)"),
  endpoint: def("endpoint", "setAgentEndpoint", "set an agent endpoint URL for a protocol (mcp, http, a2a, …)"),
  wallet: def("wallet", "setAgentWallet", "set the agent wallet record"),
  key: def("key", "setAgentKey", "publish or revoke an agent signing key"),
};

export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

export function isActionId(v: unknown): v is ActionId {
  return typeof v === "string" && v in ACTIONS;
}
