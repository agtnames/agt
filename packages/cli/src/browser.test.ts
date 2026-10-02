/**
 * The browser signer, driven by a fake page: a test "wallet" (a viem local account) polls /next and answers /result
 * the way the real page does after MetaMask approves. Also pins the hardening: Host, Origin, token, content type.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { browserSigner, WalletRejectedError } from "./browser.js";
import { networkFrom } from "./config.js";

const net = networkFrom({ network: "amoy", rpc: "http://127.0.0.1:1" }, {});

function raw(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path: u.pathname, method: opts.method ?? "GET", headers: opts.headers }, (res) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** A fake page: answers every request with `answer`, until told to close. */
function fakePage(url: string, answer: (r: { id: number; method: string; params: any }) => Promise<{ result?: unknown; error?: { code?: number; message: string } }>) {
  const origin = new URL(url).origin;
  let running = true;
  const seen: string[] = [];
  const done = (async () => {
    while (running) {
      const r = await raw(`${url}/next`);
      if (r.status === 204) continue;
      if (r.status !== 200) throw new Error(`next ${r.status}`);
      const msg = JSON.parse(r.body);
      seen.push(msg.method);
      const a = msg.method === "close" ? { result: true } : await answer(msg);
      if (msg.method === "close") running = false;
      await raw(`${url}/result`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ id: msg.id, ...a }) });
    }
  })();
  return { seen, done, stop: () => { running = false; } };
}

test("connect, personal_sign and eth_sendTransaction round-trip through the page", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  let url = "";
  let page: ReturnType<typeof fakePage> | undefined;
  const sent: any[] = [];
  const signer = await browserSigner({
    network: net, open: () => {}, onUrl: (u) => {
      url = u;
      page = fakePage(u, async (r) => {
        if (r.method === "connect") { assert.equal(r.params.chainId, "0x13882"); return { result: wallet.address.toLowerCase() }; }
        if (r.method === "personal_sign") return { result: await wallet.signMessage({ message: r.params.message }) };
        if (r.method === "eth_sendTransaction") { sent.push(r.params); return { result: "0x" + "ab".repeat(32) }; }
        return { error: { message: "unexpected" } };
      });
    },
  });
  assert.equal(signer.address, wallet.address, "address comes back checksummed");
  const sig = await signer.signMessage('{"agt":"3.0"}', "sign it");
  assert.match(sig, /^0x[0-9a-f]{130}$/);
  const hash = await signer.sendTransaction({ to: "0x0000000000000000000000000000000000000001", data: "0x1234", value: 5n, description: "tx" });
  assert.equal(hash, "0x" + "ab".repeat(32));
  assert.deepEqual({ from: sent[0].from, value: sent[0].value, chainId: sent[0].chainId }, { from: wallet.address, value: "0x5", chainId: "0x13882" });

  const html = await raw(url);
  assert.equal(html.status, 200);
  assert.match(String(html.headers["content-security-policy"]), /script-src 'nonce-[^']+'/);
  assert.equal(html.headers["cache-control"], "no-store");

  await signer.close();
  await page!.done;
  assert.deepEqual(page!.seen, ["connect", "personal_sign", "eth_sendTransaction", "close"]);
});

test("a signature that does not recover to the connected account is refused", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  let page: ReturnType<typeof fakePage> | undefined;
  const signer = await browserSigner({
    network: net, open: () => {}, onUrl: (u) => {
      page = fakePage(u, async (r) => r.method === "connect" ? { result: wallet.address } : { result: await other.signMessage({ message: r.params.message }) });
    },
  });
  await assert.rejects(signer.signMessage("hello", "x"), /does not recover/);
  await signer.close();
  await page!.done;
});

test("a rejection in the wallet (4001) surfaces as WalletRejectedError", async () => {
  let page: ReturnType<typeof fakePage> | undefined;
  await assert.rejects(browserSigner({
    network: net, open: () => {}, onUrl: (u) => { page = fakePage(u, async () => ({ error: { code: 4001, message: "User rejected the request." } })); },
  }), (e: unknown) => e instanceof WalletRejectedError && /rejected/.test((e as Error).message));
  page!.stop();
});

test("hardening: wrong token, foreign Host, missing Origin and non-JSON posts are refused", async () => {
  let url = "";
  const pending = browserSigner({ network: net, open: () => {}, timeoutMs: 5000, onUrl: (u) => { url = u; } });
  while (!url) await new Promise((r) => setTimeout(r, 10));
  const u = new URL(url);
  const port = u.port;

  assert.equal((await raw(`${u.origin}/s/not-the-token`)).status, 404);
  assert.equal((await raw(url, { headers: { host: `evil.example:${port}` } })).status, 403, "DNS-rebinding Host is refused");
  const body = JSON.stringify({ id: 1, result: "0x0000000000000000000000000000000000000001" });
  assert.equal((await raw(`${url}/result`, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 403, "no Origin");
  assert.equal((await raw(`${url}/result`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body })).status, 403, "foreign Origin");
  assert.equal((await raw(`${url}/result`, { method: "POST", headers: { origin: u.origin, "content-type": "text/plain" }, body })).status, 415);
  assert.equal((await raw(`${url}/result`, { method: "POST", headers: { origin: u.origin, "content-type": "application/json" }, body })).status, 409, "a result for a request that was never dispatched");

  await assert.rejects(pending, /timed out/);
});

test("a reload hands an open request to the new page instead of losing it", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  let page: ReturnType<typeof fakePage> | undefined;
  const signer = await browserSigner({
    network: net, open: () => {}, onUrl: (u) => {
      void (async () => {
        // The first page takes the connect request and is reloaded before it answers.
        const first = await raw(`${u}/next`);
        assert.equal(JSON.parse(first.body).method, "connect");
        assert.equal((await raw(u)).status, 200);
        page = fakePage(u, async (r) => r.method === "connect" ? { result: wallet.address } : { error: { message: "unexpected" } });
      })();
    },
  });
  assert.equal(signer.address, wallet.address);
  await signer.close();
  await page!.done;
});

test("--port: the page is served on the given port, and a taken port is reported plainly", async () => {
  const free = await new Promise<number>((resolve) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); }); });
  let url = "";
  const wallet = privateKeyToAccount(generatePrivateKey());
  let page: ReturnType<typeof fakePage> | undefined;
  const signer = await browserSigner({ network: net, port: free, open: () => {}, onUrl: (u) => { url = u; page = fakePage(u, async () => ({ result: wallet.address })); } });
  assert.equal(new URL(url).port, String(free));
  await assert.rejects(browserSigner({ network: net, port: free, open: () => {} }), /port \d+ is in use/);
  await signer.close();
  await page!.done;
});
