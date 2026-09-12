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
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = path.join(root, "packages", "mcp");
const pkgPath = path.join(mcpDir, "package.json");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const otp = args.find((a) => a.startsWith("--otp="))?.slice(6);
if (!dryRun && !otp) { console.error("usage: node scripts/publish-mcp.mjs --otp=<code> | --dry-run"); process.exit(1); }

const dirty = execSync("git status --porcelain -- packages/mcp", { cwd: root, encoding: "utf8" }).trim();
if (dirty) { console.error("packages/mcp has uncommitted changes; commit or stash first:\n" + dirty); process.exit(1); }

const resolverVersion = JSON.parse(readFileSync(path.join(root, "packages", "resolver", "package.json"), "utf8")).version;
const original = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(original);
const dep = pkg.dependencies["@agtnames/resolver"];
if (!/^(file|link):/.test(dep)) console.warn(`note: @agtnames/resolver is already "${dep}" (expected file:../resolver)`);
pkg.dependencies["@agtnames/resolver"] = `^${resolverVersion}`;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`@agtnames/mcp@${pkg.version} → @agtnames/resolver@^${resolverVersion}${dryRun ? " (dry run)" : ""}`);

try {
  const npmArgs = ["publish", ...(dryRun ? ["--dry-run"] : ["--otp=" + otp])];
  const r = spawnSync("npm", npmArgs, { cwd: mcpDir, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`npm publish exited ${r.status}`); process.exitCode = r.status ?? 1; }
} finally {
  writeFileSync(pkgPath, original);
  console.log("package.json restored (file:../resolver)");
}
