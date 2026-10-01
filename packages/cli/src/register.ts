/**
 * Register: the site signs an EIP-712 quote (the controller only accepts quotes from its quote signer), the buyer
 * approves the USDC amount and calls AGTController.register(quote, sig) from their own wallet. Same flow as the
 * browser checkout (site: src/lib/migration-client.ts registerWithQuote). The quote binds label, recipient, token,
 * price and term, and expires (about 15 minutes), so approve and register go out back to back.
 */
import { encodeFunctionData, formatUnits, getAddress, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { controllerAbi, erc20Abi } from "./abi.js";
import type { Network } from "./config.js";
import type { TxRequest } from "./signer.js";

export interface SignedQuote {
  chainId: number;
  controller: Address;
  currency: "USDC" | "native";
  usd?: number;
  years?: number;
  quote: { label: string; to: Address; payToken: Address; price: string; duration: string; validUntil: string; nonce: Hex };
  signature: Hex;
}

export interface Quote { label: string; to: Address; payToken: Address; price: bigint; duration: bigint; validUntil: bigint; nonce: Hex }

export async function fetchQuote(site: string, body: { label: string; to: Address; years: number; payToken: "usdc" }, fetchImpl: typeof fetch = fetch): Promise<SignedQuote> {
  const r = await fetchImpl(`${site}/api/v2/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as SignedQuote & { error?: string };
  if (!r.ok) throw new Error(`quote refused (${r.status}): ${j.error ?? "no reason given"}`);
  return j;
}

/** Everything the quote binds must match what was asked for and the network we are on; otherwise refuse to pay. */
export function checkQuote(q: SignedQuote, want: { label: string; to: Address }, n: Network, nowSec = Math.floor(Date.now() / 1000)): Quote {
  if (q.chainId !== n.chainId) throw new Error(`the quote is for chain ${q.chainId}, not ${n.name} (${n.chainId})`);
  if (getAddress(q.controller) !== getAddress(n.controller)) throw new Error(`the quote names controller ${q.controller}, expected ${n.controller}`);
  if (q.quote.label !== want.label) throw new Error(`the quote is for ${q.quote.label}.agt, not ${want.label}.agt`);
  if (getAddress(q.quote.to) !== getAddress(want.to)) throw new Error(`the quote mints to ${q.quote.to}, not ${want.to}`);
  if (q.currency !== "USDC" || getAddress(q.quote.payToken) !== getAddress(n.usdc)) throw new Error(`the quote asks for ${q.currency} at ${q.quote.payToken}; the CLI pays in USDC (${n.usdc})`);
  const quote: Quote = { ...q.quote, price: BigInt(q.quote.price), duration: BigInt(q.quote.duration), validUntil: BigInt(q.quote.validUntil) };
  if (quote.validUntil <= BigInt(nowSec + 60)) throw new Error("the quote expires in under a minute; run the command again");
  return quote;
}

export const usdc = (units: bigint) => `${formatUnits(units, 6)} USDC`;

export interface RegisterPlan { quote: Quote; signature: Hex; balance: bigint; allowance: bigint; txs: TxRequest[] }

export async function planRegister(pc: PublicClient, n: Network, q: SignedQuote, quote: Quote, payer: Address): Promise<RegisterPlan> {
  const [balance, allowance] = await Promise.all([
    pc.readContract({ address: n.usdc, abi: erc20Abi, functionName: "balanceOf", args: [payer] }),
    pc.readContract({ address: n.usdc, abi: erc20Abi, functionName: "allowance", args: [payer, n.controller] }),
  ]);
  const years = Number(quote.duration / (365n * 86400n));
  const txs: TxRequest[] = [];
  if (allowance < quote.price) txs.push({
    to: n.usdc,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [n.controller, quote.price] }),
    description: `Approve ${usdc(quote.price)} for the .agt controller`,
  });
  txs.push({
    to: n.controller,
    data: encodeFunctionData({ abi: controllerAbi, functionName: "register", args: [quote, q.signature] }),
    value: quote.payToken === zeroAddress ? quote.price : 0n,
    description: `Register ${quote.label}.agt for ${years} year${years === 1 ? "" : "s"} (${usdc(quote.price)}) to ${quote.to}`,
  });
  return { quote, signature: q.signature, balance, allowance, txs };
}
