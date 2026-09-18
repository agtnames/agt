// Registry manifests stay in step with package.json: node --test dist/registry-manifests.test.js
// server.json (official MCP registry) and smithery.yaml (Smithery) pin a version; publish-mcp.mjs refuses to publish
// when they drift, and this test catches the drift in CI before that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const pkg = JSON.parse(read("../package.json")) as { name: string; version: string; mcpName?: string; files: string[] };

test("server.json: official registry manifest matches package.json", () => {
  const server = JSON.parse(read("../server.json")) as {
    $schema: string; name: string; description: string; version: string;
    packages: { registryType: string; identifier: string; version: string; transport: { type: string }; runtimeHint?: string }[];
  };
  assert.match(server.$schema, /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
  assert.equal(server.name, "io.github.ds1/agt");
  assert.equal(pkg.mcpName, server.name, "the registry checks package.json mcpName against server.json name");
  assert.equal(server.version, pkg.version);
  assert.ok(server.description.length <= 100, "schema caps description at 100 characters");
  assert.equal(server.packages.length, 1);
  const [npm] = server.packages;
  assert.equal(npm.registryType, "npm");
  assert.equal(npm.identifier, pkg.name);
  assert.equal(npm.version, pkg.version);
  assert.equal(npm.transport.type, "stdio");
  assert.equal(npm.runtimeHint, "npx");
});

test("smithery.yaml: pins the same npm version", () => {
  const yaml = read("../smithery.yaml");
  assert.match(yaml, /^startCommand:\s*$/m);
  assert.match(yaml, /^\s+type: stdio\s*$/m);
  assert.ok(yaml.includes(`'${pkg.name}@${pkg.version}'`), `smithery.yaml must start ${pkg.name}@${pkg.version}`);
});

test("package.json files: tests stay out of the tarball; manifests are repo-only", () => {
  assert.ok(pkg.files.includes("!dist/*.test.js"));
  assert.ok(!pkg.files.includes("server.json") && !pkg.files.includes("smithery.yaml"));
});
