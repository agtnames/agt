/**
 * Browser-wallet signer: the CLI serves one page on 127.0.0.1 and the page asks MetaMask (or any EIP-1193 wallet
 * injected as window.ethereum) to approve each request. The key never leaves the wallet, and nothing outside this
 * machine is involved: no relay, no project id.
 *
 * Protocol (all under /s/<token>, a random 192-bit path the CLI prints and opens):
 *   GET  /s/<token>          the page
 *   GET  /s/<token>/next     long poll: the next request { id, method, params, description }, or 204 after 25 s
 *   POST /s/<token>/result   { id, result } or { id, error: { code?, message } }
 *
 * Hardening: bound to 127.0.0.1 only; the Host header must be this origin (DNS rebinding); POSTs must carry this
 * Origin and a JSON body; the token is compared in constant time; every response is no-store and the page runs
 * under a nonce CSP with connect-src 'self'. The CLI re-checks what comes back: a signature must recover to the
 * connected address, and the page re-checks the chain and account before each transaction.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import type { Network } from "./config.js";
import type { Signer, TxRequest } from "./signer.js";

type Method = "connect" | "personal_sign" | "eth_sendTransaction" | "close";

interface Pending {
  id: number;
  method: Method;
  params: unknown;
  description: string;
  dispatched: boolean;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer?: NodeJS.Timeout;
}

export interface BrowserSignerOptions {
  network: Network;
  /** Opens the URL; default launches the system browser. Pass a no-op for --no-open or tests. */
  open?: (url: string) => void;
  /** Called once with the URL so the terminal can show it. */
  onUrl?: (url: string) => void;
  /** Per-request wait for the user, default 10 minutes. */
  timeoutMs?: number;
  port?: number;
}

export class WalletRejectedError extends Error {
  constructor(message: string, readonly code?: number) { super(message); this.name = "WalletRejectedError"; }
}

export function openInBrowser(url: string): void {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd as string, args as string[], { detached: true, stdio: "ignore" }).on("error", () => {}).unref(); } catch { /* the URL is printed too */ }
}

const utf8Hex = (s: string): Hex => ("0x" + Buffer.from(s, "utf8").toString("hex")) as Hex;

export async function browserSigner(opts: BrowserSignerOptions): Promise<Signer> {
  const { network } = opts;
  const token = randomBytes(24).toString("base64url");
  const nonce = randomBytes(16).toString("base64");
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const queue: Pending[] = [];
  const waiters: ServerResponse[] = [];
  let nextId = 1;
  let origin = "";

  const server = createServer((req, res) => handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, "error"); }));
  await new Promise<void>((resolve, reject) => {
    server.once("error", (e: NodeJS.ErrnoException) => reject(e.code === "EADDRINUSE" ? new Error(`port ${opts.port} is in use (is another agt command still waiting for the wallet?)`) : e));
    server.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const tokenBuf = Buffer.from(token);

  function send(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8") {
    res.writeHead(status, {
      "content-type": type,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    });
    res.end(body);
  }

  const tokenOk = (t: string) => { const b = Buffer.from(t); return b.length === tokenBuf.length && timingSafeEqual(b, tokenBuf); };

  function dispatch(): void {
    while (waiters.length) {
      const p = queue.find((q) => !q.dispatched);
      if (!p) return;
      const res = waiters.shift()!;
      if (res.writableEnded || res.destroyed) continue;
      p.dispatched = true;
      send(res, 200, JSON.stringify({ id: p.id, method: p.method, params: p.params, description: p.description }), "application/json");
    }
  }

  async function readBody(req: IncomingMessage): Promise<string> {
    let size = 0; const chunks: Buffer[] = [];
    for await (const c of req) { size += (c as Buffer).length; if (size > 64 * 1024) throw new Error("body too large"); chunks.push(c as Buffer); }
    return Buffer.concat(chunks).toString("utf8");
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!allowedHosts.has(req.headers.host ?? "")) return send(res, 403, "forbidden host");
    const m = /^\/s\/([A-Za-z0-9_-]+)(\/next|\/result)?$/.exec((req.url ?? "").split("?")[0]);
    if (!m || !tokenOk(m[1])) return send(res, 404, "not found");
    const route = m[2] ?? "";

    if (req.method === "GET" && route === "") {
      // A (re)load replaces the page that held any dispatched request; hand those to the new page instead of losing them.
      for (const p of queue) p.dispatched = false;
      return send(res, 200, page(nonce, network), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && route === "/next") {
      waiters.push(res);
      const t = setTimeout(() => { const i = waiters.indexOf(res); if (i >= 0) { waiters.splice(i, 1); res.writeHead(204, { "cache-control": "no-store" }); res.end(); } }, 25_000);
      res.on("close", () => { clearTimeout(t); const i = waiters.indexOf(res); if (i >= 0) waiters.splice(i, 1); });
      return dispatch();
    }

    if (req.method === "POST" && route === "/result") {
      if (!allowedOrigins.has(req.headers.origin ?? "")) return send(res, 403, "forbidden origin");
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, "json only");
      let msg: { id?: number; result?: unknown; error?: { code?: number; message?: string } };
      try { msg = JSON.parse(await readBody(req)); } catch { return send(res, 400, "bad json"); }
      const i = queue.findIndex((q) => q.id === msg.id && q.dispatched);
      if (i < 0) return send(res, 409, "no such request");
      const [p] = queue.splice(i, 1);
      clearTimeout(p.timer);
      send(res, 204, "");
      if (msg.error) {
        const code = msg.error.code;
        p.reject(code === 4001 ? new WalletRejectedError("you rejected the request in the wallet", code) : new Error(`wallet: ${msg.error.message ?? "request failed"}`));
      } else p.resolve(msg.result);
      return;
    }
    send(res, 405, "method not allowed");
  }

  function request<T>(method: Method, params: unknown, description: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const p: Pending = { id: nextId++, method, params, description, dispatched: false, resolve: resolve as (v: unknown) => void, reject };
      if (method !== "close") p.timer = setTimeout(() => {
        const i = queue.indexOf(p); if (i >= 0) queue.splice(i, 1);
        reject(new Error(`timed out after ${Math.round(timeoutMs / 60000)} min waiting for the wallet (is the page at ${origin}/s/… still open?)`));
      }, timeoutMs);
      queue.push(p);
      dispatch();
    });
  }

  const url = `${origin}/s/${token}`;
  opts.onUrl?.(url);
  (opts.open ?? openInBrowser)(url);

  const shutdown = async () => {
    for (const p of queue.splice(0)) { clearTimeout(p.timer); p.reject(new Error("signer closed")); }
    for (const w of waiters.splice(0)) { try { w.writeHead(204); w.end(); } catch { /* gone */ } }
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  };

  let address: Address;
  try {
    const connected = await request<string>("connect", chainParams(network), `Connect a wallet on ${network.chain.name}`);
    address = getAddress(connected);
  } catch (e) { await shutdown(); throw e; }

  return {
    kind: "browser",
    address,
    async signMessage(message, description) {
      const sig = await request<Hex>("personal_sign", { message, hex: utf8Hex(message), address }, description);
      if (!(await verifyMessage({ address, message, signature: sig }))) throw new Error(`the wallet returned a signature that does not recover to ${address}`);
      return sig;
    },
    async sendTransaction(tx: TxRequest) {
      const hash = await request<Hex>("eth_sendTransaction", {
        from: address, to: tx.to, data: tx.data, value: "0x" + (tx.value ?? 0n).toString(16), chainId: "0x" + network.chainId.toString(16),
      }, tx.description);
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) throw new Error("the wallet did not return a transaction hash");
      return hash;
    },
    async close() {
      const bye = request<void>("close", null, "All done. You can close this tab.").catch(() => {});
      await Promise.race([bye, new Promise((r) => setTimeout(r, 1500))]);
      await shutdown();
    },
  };
}

function chainParams(n: Network) {
  return {
    chainId: "0x" + n.chainId.toString(16),
    chainName: n.chain.name,
    nativeCurrency: n.chain.nativeCurrency,
    rpcUrls: n.rpcUrls,
    blockExplorerUrls: [n.explorer],
  };
}

/** The wallet page. Everything shown to the user goes through textContent; nothing from a request is parsed as HTML. */
function page(nonce: string, n: Network): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agt · sign with your wallet</title>
<style>
  :root { color-scheme: light dark; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  body { max-width: 640px; margin: 48px auto; padding: 0 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { opacity: .7; }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 16px; margin: 20px 0; }
  pre { white-space: pre-wrap; word-break: break-all; font-size: 12px; max-height: 320px; overflow: auto; background: #8881; padding: 10px; border-radius: 6px; }
  button { font: inherit; padding: 8px 16px; border-radius: 8px; border: 1px solid #8886; cursor: pointer; }
  .err { color: #d33; } .ok { color: #2a2; }
  dt { font-weight: 600; margin-top: 6px; } dd { margin: 0; word-break: break-all; font-family: ui-monospace, monospace; font-size: 13px; }
</style></head>
<body>
<h1>agt command line</h1>
<div class="muted">Network: ${n.chain.name} (chain ${n.chainId}). Requests from the terminal appear here; approve each in your wallet.</div>
<div class="card"><div id="status">Waiting for the terminal…</div><div id="detail"></div><p id="action"></p></div>
<div class="muted" id="account"></div>
<script nonce="${nonce}">
(() => {
  const base = location.pathname;
  const $ = (id) => document.getElementById(id);
  let eth = window.ethereum || null;
  const announced = [];
  window.addEventListener("eip6963:announceProvider", (e) => { if (e.detail && e.detail.provider) announced.push(e.detail); });
  window.addEventListener("ethereum#initialized", () => { eth = eth || window.ethereum || null; }, { once: true });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Waits for a wallet instead of failing: a wallet that cannot see this page usually needs site access and a reload,
  // and the terminal keeps the request open across the reload.
  async function wallet() {
    for (let i = 0; ; i++) {
      if (!eth) { const mm = announced.find((d) => /metamask/i.test((d.info && d.info.rdns) || "")) || announced[0]; eth = window.ethereum || (mm && mm.provider) || null; }
      if (eth) return eth;
      if (i === 6) setStatus("MetaMask can't see this page yet. Click the MetaMask icon in the browser toolbar and allow it on this site (or add http://127.0.0.1 to its site access), then reload this page. The terminal keeps waiting.", "err");
      if (i % 4 === 0) window.dispatchEvent(new Event("eip6963:requestProvider"));
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const setStatus = (text, cls) => { const s = $("status"); s.textContent = text; s.className = cls || ""; };
  const clear = () => { $("detail").replaceChildren(); $("action").replaceChildren(); };
  const pre = (text) => { const p = document.createElement("pre"); p.textContent = text; return p; };
  const dl = (rows) => { const d = document.createElement("dl"); for (const [k, v] of rows) { const t = document.createElement("dt"); t.textContent = k; const x = document.createElement("dd"); x.textContent = v; d.append(t, x); } return d; };
  let account = null, chain = null, stopped = false;

  async function post(body) {
    await fetch(base + "/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  function choice(labels) {
    return new Promise((resolve) => {
      $("action").replaceChildren(...labels.map((label, i) => { const b = document.createElement("button"); b.textContent = label; b.style.marginRight = "8px"; b.onclick = () => { for (const x of $("action").children) x.disabled = true; resolve(i); }; return b; }));
    });
  }
  async function attempt(r) {
    for (;;) {
      try { return { result: await run(r) }; }
      catch (e) {
        const code = e && e.code, message = (e && e.message) || String(e);
        if (code === 4001) return { error: { code, message } };
        const hint = r.method === "eth_sendTransaction" ? " If MetaMask's activity shows the transaction was sent, choose Cancel." : "";
        setStatus(message + hint, "err");
        if ((await choice(["Try again", "Cancel"])) !== 0) return { error: { code, message } };
      }
    }
  }
  function button(label) {
    return new Promise((resolve) => { const b = document.createElement("button"); b.textContent = label; b.onclick = () => { b.disabled = true; resolve(); }; $("action").replaceChildren(b); });
  }
  async function ensureChain(params) {
    const current = await eth.request({ method: "eth_chainId" });
    if (current.toLowerCase() === params.chainId.toLowerCase()) return;
    try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: params.chainId }] }); }
    catch (e) {
      if (e && (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902))) await eth.request({ method: "wallet_addEthereumChain", params: [params] });
      else throw e;
    }
    const after = await eth.request({ method: "eth_chainId" });
    if (after.toLowerCase() !== params.chainId.toLowerCase()) throw new Error("the wallet is on chain " + parseInt(after, 16) + ", expected " + parseInt(params.chainId, 16));
  }
  async function ensureAccount(expected) {
    const accs = await eth.request({ method: "eth_accounts" });
    if (!accs.length || accs[0].toLowerCase() !== expected.toLowerCase()) throw new Error("the wallet's selected account changed to " + (accs[0] || "none") + "; switch back to " + expected);
  }

  async function run(r) {
    clear();
    if (r.method === "close") { stopped = true; setStatus(r.description, "ok"); await post({ id: r.id, result: true }); return; }
    setStatus(r.description);
    await wallet();
    setStatus(r.description);
    if (r.method === "connect") {
      chain = r.params;
      $("detail").append(dl([["Network", chain.chainName + " (" + parseInt(chain.chainId, 16) + ")"]]));
      await button("Connect wallet");
      const accs = await eth.request({ method: "eth_requestAccounts" });
      await ensureChain(chain);
      account = accs[0];
      $("account").textContent = "Connected: " + account;
      return account;
    }
    if (r.method === "personal_sign") {
      $("detail").append(dl([["Signing as", r.params.address]]), pre(r.params.message));
      await ensureAccount(r.params.address);
      return eth.request({ method: "personal_sign", params: [r.params.hex, r.params.address] });
    }
    if (r.method === "eth_sendTransaction") {
      const p = r.params;
      $("detail").append(dl([["From", p.from], ["To", p.to], ["Value (wei)", BigInt(p.value).toString()], ["Data", (p.data.length - 2) / 2 + " bytes"]]), pre(p.data));
      await ensureChain(chain);
      await ensureAccount(p.from);
      const { chainId, ...tx } = p;
      return eth.request({ method: "eth_sendTransaction", params: [tx] });
    }
    throw new Error("unknown request " + r.method);
  }

  async function loop() {
    while (!stopped) {
      let r;
      try { const res = await fetch(base + "/next", { cache: "no-store" }); if (res.status === 204) continue; if (!res.ok) throw new Error("terminal returned " + res.status); r = await res.json(); }
      catch (e) { setStatus("Lost the terminal connection. If the command finished, close this tab.", "err"); return; }
      const out = await attempt(r);
      if (r.method === "close") continue;
      try {
        if (out.error) { setStatus(out.error.message, "err"); await post({ id: r.id, error: out.error }); }
        else { setStatus("Sent back to the terminal.", "ok"); await post({ id: r.id, result: out.result }); }
      } catch (e) { setStatus("Lost the terminal connection. If the command finished, close this tab.", "err"); return; }
    }
  }
  loop();
})();
</script>
</body></html>`;
}
