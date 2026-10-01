/**
 * Who signs. Every write command takes a Signer, so the commands never see a key:
 *
 *   browser   (default) a local page asks MetaMask, or any injected wallet, to approve each signature (browser.ts)
 *   key       a 0x-prefixed private key in an environment variable (AGT_OWNER_KEY, or the one --key-env names)
 *   keyfile   a passphrase-encrypted key file (keyfile.ts), for automation that should not hold a raw key in env
 *
 * A key is never read from a command-line argument, where it would land in shell history.
 */
import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Network } from "./config.js";

export interface TxRequest {
  to: Address;
  data: Hex;
  value?: bigint;
  /** One line shown in the wallet page and the terminal: what this transaction does. */
  description: string;
}

export interface Signer {
  kind: "browser" | "key" | "keyfile";
  address: Address;
  /** EIP-191 personal_sign over the UTF-8 message. */
  signMessage(message: string, description: string): Promise<Hex>;
  sendTransaction(tx: TxRequest): Promise<Hex>;
  close(): Promise<void>;
}

/**
 * Check a private key's shape before use and say what is wrong in plain words. The traps from the first terminal run:
 * a missing 0x, a passphrase pasted where the key belongs, and an address pasted where the key belongs.
 */
export function parsePrivateKey(raw: string | undefined, source: string): Hex {
  const v = (raw ?? "").trim();
  if (!v) throw new Error(`${source} is empty. Set it to the name owner's private key (0x followed by 64 hex characters).`);
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return v as Hex;
  if (/^[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${source} is missing the 0x prefix. Use 0x${v.slice(0, 4)}… (0x followed by the 64 hex characters).`);
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`${source} holds an address, not a private key. The key is 64 hex characters; the address is 40.`);
  if (/^0x[0-9a-fA-F]*$/.test(v)) throw new Error(`${source} is ${v.length - 2} hex characters after 0x; a private key is exactly 64.`);
  throw new Error(`${source} is not a private key. If this is your keyfile passphrase, pass the file with --keyfile and the passphrase in AGT_KEYFILE_PASSPHRASE instead.`);
}

export function keySigner(pk: Hex, network: Network, kind: "key" | "keyfile" = "key"): Signer {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: network.chain, transport: http(network.rpcUrls[0]) });
  return {
    kind,
    address: account.address,
    signMessage: (message) => account.signMessage({ message }),
    sendTransaction: (tx) => wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n }),
    close: async () => {},
  };
}
