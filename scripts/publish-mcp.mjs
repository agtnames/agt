#!/usr/bin/env node
/**
 * Publish @agtnames/mcp with its resolver dependency flipped from `file:../resolver` to the published range.
 *
 *   node scripts/publish-mcp.mjs --otp=123456        # publish (2FA code from the authenticator)
 *   node scripts/publish-mcp.mjs --dry-run           # show the tarball that would be published
 *
 * Steps: refuse on a dirty packages/mcp → rewrite the dependency to ^<packages/resolver version> → `npm publish`
 * (prepublishOnly runs the dependency guard, build and tests) → restore package.json in `finally`.
 * Publish the resolver first whenever its version moved; the range written here must exist on npm.
 * Same for @agtnames/countersign (file:../countersign → ^<packages/countersign version>).
 * Registry manifests (packages/mcp/server.json for the official MCP registry, smithery.yaml for Smithery) pin the
 * same version, as does gemini-extension.json at the repo root (Gemini CLI extensions gallery): the script refuses to
 * publish when any of them differs, and prints the re-listing steps after.
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = path.join(root, "packages", "mcp");
const pkgPath = path.join(mcpDir, "package.json");
const serverJsonPath = path.join(mcpDir, "server.json");
const smitheryPath = path.join(mcpDir, "smithery.yaml");
const geminiPath = path.join(root, "gemini-extension.json");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
// --otp=<code> for authenticator-app 2FA; without it npm prompts (browser-based 2FA) — run from a real terminal.
const otp = args.find((a) => a.startsWith("--otp="))?.slice(6);
if (args.some((a) => !["--dry-run"].includes(a) && !a.startsWith("--otp="))) { console.error("usage: node scripts/publish-mcp.mjs [--otp=<code>] [--dry-run]"); process.exit(1); }

const dirty = execSync("git status --porcelain -- packages/mcp", { cwd: root, encoding: "utf8" }).trim();
if (dirty) { console.error("packages/mcp has uncommitted changes; commit or stash first:\n" + dirty); process.exit(1); }

const resolverVersion = JSON.parse(readFileSync(path.join(root, "packages", "resolver", "package.json"), "utf8")).version;
const original = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(original);
// Registry manifests must pin the version being published (#345): bump them in the same PR as package.json.
const serverJson = JSON.parse(readFileSync(serverJsonPath, "utf8"));
const npmPkg = (serverJson.packages ?? []).find((p) => p.registryType === "npm" && p.identifier === pkg.name);
if (serverJson.version !== pkg.version || npmPkg?.version !== pkg.version) {
  console.error(`packages/mcp/server.json pins ${serverJson.version} / npm ${npmPkg?.version ?? "(missing)"} but package.json is ${pkg.version}; bump server.json (and smithery.yaml) first`);
  process.exit(1);
}
if (pkg.mcpName !== serverJson.name) { console.error(`package.json mcpName "${pkg.mcpName}" must equal server.json name "${serverJson.name}" (registry ownership check)`); process.exit(1); }
if (!readFileSync(smitheryPath, "utf8").includes(`${pkg.name}@${pkg.version}`)) {
  console.error(`packages/mcp/smithery.yaml does not start ${pkg.name}@${pkg.version}; bump the pin in commandFunction first`);
  process.exit(1);
}
const gemini = JSON.parse(readFileSync(geminiPath, "utf8"));
if (gemini.version !== pkg.version) { console.error(`gemini-extension.json pins ${gemini.version} but package.json is ${pkg.version}; bump it first (the Gemini CLI gallery reads the manifest version from a release tag)`); process.exit(1); }
const dep = pkg.dependencies["@agtnames/resolver"];
if (!/^(file|link):/.test(dep)) console.warn(`note: @agtnames/resolver is already "${dep}" (expected file:../resolver)`);
pkg.dependencies["@agtnames/resolver"] = `^${resolverVersion}`;
const countersignVersion = JSON.parse(readFileSync(path.join(root, "packages", "countersign", "package.json"), "utf8")).version;
if (pkg.dependencies["@agtnames/countersign"]) pkg.dependencies["@agtnames/countersign"] = `^${countersignVersion}`;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`@agtnames/mcp@${pkg.version} → @agtnames/resolver@^${resolverVersion}, @agtnames/countersign@^${countersignVersion}${dryRun ? " (dry run)" : ""}`);

try {
  const npmArgs = ["publish", ...(dryRun ? ["--dry-run"] : []), ...(otp ? ["--otp=" + otp] : [])];
  const r = spawnSync("npm", npmArgs, { cwd: mcpDir, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`npm publish exited ${r.status}`); process.exitCode = r.status ?? 1; }
  else if (!dryRun) {
    console.log(`
Published @agtnames/mcp@${pkg.version}. Registry listings next (#345):
  1. server.json + smithery.yaml already pin ${pkg.version} (checked above); if this was a version bump, they were bumped in the same PR.
  2. Official MCP registry, from packages/mcp:  mcp-publisher login github   then   mcp-publisher publish
     (first time: install mcp-publisher, see packages/mcp/README.md "Listed in"; the registry verifies package.json mcpName
      against server.json name, so wait ~5 min for npm to serve the new tarball before publishing).
  3. Smithery: the listing re-reads smithery.yaml from the default branch; re-publish from the server's Smithery page if it does not.
  4. Glama / PulseMCP / mcp.so: pull from npm + GitHub; nothing to do unless the README changed the install command.
  5. Plugin pin: ds1/agt-plugins .mcp.json -> @agtnames/mcp@${pkg.version}, tag v${pkg.version}.
`);
  }
} finally {
  writeFileSync(pkgPath, original);
  console.log("package.json restored (file:../resolver, file:../countersign)");
}
