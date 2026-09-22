import type { SnapConfig } from "@metamask/snaps-cli";

// mm-snap build bundles src/index.ts into dist/bundle.js and rewrites the shasum in snap.manifest.json.
// No polyfills: @agtnames/resolver's main entry uses fetch, TextEncoder/Decoder, atob and @noble/* only.
const config: SnapConfig = {
  input: "./src/index.ts",
  output: { path: "./dist", filename: "bundle.js", clean: true },
  manifest: { path: "./snap.manifest.json", update: true },
  server: { port: 8023 },
  polyfills: false,
  // stats.buffer is off: the CLI's check matches `ArrayBuffer.isView` / `response.arrayBuffer()` in the bundle;
  // the bundle has no Node `Buffer` (verified 2026-09-21: the only matches are those two).
  stats: { buffer: false, builtIns: { ignore: [] } },
};

export default config;
