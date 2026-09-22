# Changelog

## 0.1.2 — 2026-09-22

- Icon rewritten as a single-line SVG (no title element or comment) after MetaMask Flask rejected the 0.1.1 icon with "Snap icon must be a valid SVG". No functional change.

## 0.1.1 — 2026-09-22

- Icon in the manifest (images/icon.svg, the agt mark). No functional change; the bundle is the same as 0.1.0.

## 0.1.0 — 2026-09-22

- First release. `onNameLookup` resolves `name.agt` in the send field. On Polygon: the name's payment wallet (`agentWallet`, label `AGT Registry`) and, when different, its owner account (`addr`, label `AGT Registry (owner account)`). On Ethereum, Base, Arbitrum, Optimism, BNB Chain and Avalanche: the per-chain `addr(coinType)` record when set, else `addr` when it is a key-controlled account (contract accounts are not reused across chains). On-chain reads through `@agtnames/resolver` (`resolveAddresses`, two batched JSON-RPC round trips, sticky endpoint fallback); read failures resolve to nothing. Permissions: `endowment:name-lookup` (`tlds: ["agt"]`, seven EVM chains, `maxRequestTime` 15 s), `endowment:network-access`.
