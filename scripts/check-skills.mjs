#!/usr/bin/env node
/**
 * Lint the public copy in this repository: skills/, spec/, GEMINI.md, the package READMEs and the root docs.
 *
 *   node scripts/check-skills.mjs            exit 1 on any problem
 *
 * Rules (a trimmed copy of the site's content linter, so the same guarantees hold after the packages moved here):
 *   - vendor black-box: user-facing copy never names the upstream registry vendor; say "the registry"
 *   - no links into the private site repository (github.com/<owner>/agt-site) or the retired personal-login paths
 *     (github.com/ds1/); public surfaces link github.com/agtnames/agt or agtnames.com
 *   - no "No X, no Y" negative framing openers and no compatibility claims limited to a named subset ("only works with")
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = ["skills", "spec", "GEMINI.md", "README.md", "CONTRIBUTING.md", "SECURITY.md", "packages/resolver/README.md", "packages/countersign/README.md", "packages/mcp/README.md", "packages/snap/README.md", "packages/snap/CHANGELOG.md", "packages/snap/snap.manifest.json"];
// The vendor's name, split so this file does not itself trip the rule.
const VENDOR = ["Free" + "name", "free" + "name"];

function walk(p, out = []) {
  const st = statSync(p);
  if (st.isDirectory()) { for (const f of readdirSync(p)) if (!f.startsWith(".") && f !== "node_modules") walk(join(p, f), out); }
  else if (/\.(md|mdx|json|yaml|yml)$/i.test(p)) out.push(p);
  return out;
}

export function check(rel, text) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    for (const v of VENDOR) if (line.includes(v)) problems.push(`${at}: names the upstream registry vendor; say "the registry"`);
    if (/github\.com\/ds1\//.test(line)) problems.push(`${at}: link to the retired github.com/ds1/ path; use github.com/agtnames/agt`);
    if (/github\.com\/agtnames\/agt-site/.test(line)) problems.push(`${at}: link into the private site repository; public surfaces link github.com/agtnames/agt`);
    if (/\bonly works with\b/i.test(line)) problems.push(`${at}: compatibility claim limited to a named subset; lead with the broad claim`);
    if (/^\s*(no|without)\s+[^.]{2,40},\s*(no|without)\s+/i.test(line)) problems.push(`${at}: "No X, no Y" negative framing; say what it is`);
  });
  return problems;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = TARGETS.flatMap((t) => { try { return walk(join(root, t)); } catch { return []; } });
  const problems = files.flatMap((f) => check(relative(root, f).replace(/\\/g, "/"), readFileSync(f, "utf8")));
  if (problems.length) { for (const p of problems) console.error(p); console.error(`\n${problems.length} problem(s) in ${files.length} files`); process.exit(1); }
  console.log(`OK: ${files.length} files checked`);
}
