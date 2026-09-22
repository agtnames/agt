# Changelog

## 0.1.0 — unreleased

- First release. `onNameLookup` resolves `name.agt` to the name's `addr` (label `AGT Registry`) and, when set and different, its `agentWallet` (label `AGT Registry (agent wallet)`) on Polygon, Ethereum, Base, Arbitrum, Optimism, BNB Chain and Avalanche. On-chain reads through `@agtnames/resolver` (`resolveAddresses`, two batched JSON-RPC round trips, endpoint fallback). Permissions: `endowment:name-lookup` (`tlds: ["agt"]`), `endowment:network-access`.
