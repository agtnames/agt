/**
 * The contract surface the CLI writes through. Mirrors the site's src/lib/agt-abi.ts (source of truth:
 * contracts/contracts/launch/*.sol); only what the four write commands need.
 */
import { parseAbi } from "viem";

export const controllerAbi = parseAbi([
  "struct Quote { string label; address to; address payToken; uint256 price; uint64 duration; uint64 validUntil; bytes32 nonce; }",
  "function register(Quote q, bytes sig) payable returns (uint256)",
  "function available(string label) view returns (bool)",
  "function valid(string label) view returns (bool)",
  "function paused() view returns (bool)",
  "function usedNonce(bytes32) view returns (bool)",
]);

export const registryAbi = parseAbi([
  "function tokenIdOf(string label) pure returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function resolverOf(uint256 tokenId) view returns (address)",
]);

export const resolverAbi = parseAbi([
  "function setAgentManifest(bytes32 node, string uri)",
  "function setAgentEndpoint(bytes32 node, string protocol, string url)",
  "function setAddr(bytes32 node, address a)",
  "function setAgentWallet(bytes32 node, address wallet)",
  "function agentManifest(bytes32 node) view returns (string)",
  "function agentEndpoint(bytes32 node, string protocol) view returns (string)",
  "function multicall(bytes[] data) returns (bytes[])",
]);

export const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
