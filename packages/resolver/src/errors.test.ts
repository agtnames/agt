// RpcUnavailableError keeps the transport error's structure for callers that classify by name / cause (the MCP server).
import { test } from "node:test";
import assert from "node:assert/strict";
import { AgtResolver, RpcUnavailableError } from "./index.js";

test("all endpoints down → RpcUnavailableError with the last transport error as cause and the endpoint list", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }) as typeof fetch;
  try {
    const agt = new AgtResolver({ rpcUrls: ["https://a.example", "https://b.example"], registry: "0x5B9386C47395B0551c814cC03b69cbD20eb0C87A" });
    await assert.rejects(agt.available("foo.agt"), (e: unknown) => {
      assert.ok(e instanceof RpcUnavailableError);
      const err = e as RpcUnavailableError;
      assert.equal(err.name, "RpcUnavailableError");
      assert.equal(err.code, "RPC_UNAVAILABLE");
      assert.deepEqual(err.endpoints, ["https://a.example", "https://b.example"]);
      assert.match(err.message, /^rpc failed on 2 endpoint\(s\): fetch failed$/);
      assert.equal((err.cause as TypeError).message, "fetch failed");
      assert.equal(((err.cause as { cause?: { code?: string } }).cause)?.code, "ECONNREFUSED");
      return true;
    });
  } finally { globalThis.fetch = real; }
});

test("a JSON-RPC error item is not wrapped: it is an answer, not an outage", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted" } })) as typeof fetch;
  try {
    const agt = new AgtResolver({ rpcUrls: ["https://a.example"], registry: "0x5B9386C47395B0551c814cC03b69cbD20eb0C87A" });
    await assert.rejects(agt.available("foo.agt"), (e: unknown) => !(e instanceof RpcUnavailableError) && /execution reverted/.test((e as Error).message));
  } finally { globalThis.fetch = real; }
});
