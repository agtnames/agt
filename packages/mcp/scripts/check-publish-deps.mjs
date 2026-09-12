// prepublishOnly guard: refuse to publish while any dependency still points at a local path.
// `@agtnames/resolver` is `file:../resolver` in development so the working tree is linked; the published
// tarball must carry a registry range instead (scripts/publish-mcp.mjs at the repo root does the flip).
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const bad = Object.entries(pkg.dependencies ?? {}).filter(([, v]) => /^(file|link):/.test(String(v)));
if (bad.length) {
  console.error("refusing to publish: local dependencies in package.json →", bad.map(([k, v]) => `${k}=${v}`).join(", "));
  console.error("run `node scripts/publish-mcp.mjs --otp=<code>` from the repo root instead of `npm publish`.");
  process.exit(1);
}
console.log("publish deps ok:", Object.entries(pkg.dependencies ?? {}).map(([k, v]) => `${k}@${v}`).join(" "));
