// Refuse to publish with a file: dependency: a tarball that points at ../resolver installs nothing for anyone else.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const bad = Object.entries(pkg.dependencies ?? {}).filter(([, v]) => String(v).startsWith("file:"));
if (bad.length) {
  console.error(`refusing to publish: ${bad.map(([k, v]) => `${k}@${v}`).join(", ")} must be a registry range`);
  process.exit(1);
}
