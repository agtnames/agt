# @agtnames/snap

A MetaMask Snap that lets a person type `name.agt` in the send field and pay the name's on-chain address. It resolves AGT Registry records on Polygon (`addr`, and the agent's declared payment wallet when it differs) and answers on the major EVM networks.

## Install

Until the Snap is allowlisted in the MetaMask Snaps Directory it installs in [MetaMask Flask](https://metamask.io/flask/) only. From a dapp or the browser console on a page connected to MetaMask:

```js
await window.ethereum.request({
  method: "wallet_requestSnaps",
  params: { "npm:@agtnames/snap": {} },
});
```

Then open MetaMask, start a send on Polygon, Ethereum, Base, Arbitrum, Optimism, BNB Chain or Avalanche, and type a name such as `launchpad.agt`. The resolved address appears with the label **AGT Registry**.

## What it resolves

| Record on the name | Shown as | When |
|---|---|---|
| `addr` | `AGT Registry` | always, when set |
| `agentWallet` | `AGT Registry (agent wallet)` | only when set and different from `addr` |

Lapsed, unregistered or record-less names show nothing. Other resolver Snaps may return a legacy record for the same name; look for the AGT Registry label. Reads go straight to Polygon public JSON-RPC endpoints through [`@agtnames/resolver`](../resolver) (two batched round trips, no third-party API). Address → name (reverse lookup) and per-chain `addr(coinType)` overrides are planned for the next version.

## Permissions

- `endowment:name-lookup` for `.agt` on the seven EVM chains above.
- `endowment:network-access` to reach Polygon JSON-RPC.

No accounts, keys, state or UI. Source: [github.com/agtnames/agt](https://github.com/agtnames/agt) (`packages/snap`).

## Development

```
npm ci
npm run build          # mm-snap build → dist/bundle.js, updates the shasum in snap.manifest.json
npm test               # builds, then jest (@metamask/snaps-jest); AGT_LIVE_TEST=1 adds a mainnet read
npm start              # mm-snap watch + local server on :8023 for Flask (`local:http://localhost:8023`)
npm run manifest:check # fails if the committed shasum does not match the bundle
```

Releases: tag `snap-v*` in `agtnames/agt`; every new version must be re-submitted to the Snaps Directory before non-Flask users can install it.

## License

MIT
