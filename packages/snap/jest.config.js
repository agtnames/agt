/** @type {import('jest').Config} */
module.exports = {
  // @metamask/snaps-jest: the environment serves snap.manifest.json + dist/bundle.js (run `mm-snap build` first)
  // and gives tests `installSnap()` with the onNameLookup helper. Pure-logic tests opt out with `@jest-environment node`.
  preset: "@metamask/snaps-jest",
  transform: { "^.+\\.[jt]sx?$": ["@swc/jest", { jsc: { target: "es2022", parser: { syntax: "typescript" } } }] },
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  // @agtnames/resolver is ESM-only (`exports` has no `require` condition), so point Jest at its entry and let swc
  // transform it; @noble/* ship CJS builds and need neither.
  moduleNameMapper: { "^@agtnames/resolver$": "<rootDir>/node_modules/@agtnames/resolver/dist/index.js" },
  transformIgnorePatterns: ["/node_modules/(?!@agtnames/)"],
};
