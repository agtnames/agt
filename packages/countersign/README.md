# @agtnames/countersign

Scoped session grants for `.agt` owners. An owner signs **one** mandate; a local agent performs the covered record writes on the owner's names without further prompts; the chain refuses everything else.

A grant covers: **which names**, **which record setters**, **until when**, **how many calls per name**, **which session key**. It can never move value, never touch the registry or controller, and the owner revokes every grant at once with a single transaction. Every line of the summary the library prints is a caveat enforced on-chain by the MetaMask Delegation Framework; `describeGrant` rebuilds the grant from its summary and refuses any blob whose caveats differ.

Status: v0.1, Polygon (137) and Amoy (80002). Format `version: 1` is a draft until the first production writer ships.

## How it works

1. The owner's wallet is upgraded in place with EIP-7702 to MetaMask's stateless delegator. The address does not change. MetaMask does this when it switches an account to a smart account.
2. The agent creates a **session key** locally and tells the owner its address.
3. The owner builds a grant for that session (names, actions, expiry, call count) and signs one EIP-712 message per name.
4. The agent imports the grant and redeems it: each write goes through the DelegationManager, which checks every caveat and then executes the call **from the owner's address**. The resolver's `authorised(node)` check passes; a bare session key would be rejected.
5. To revoke everything the owner bumps their `NonceEnforcer` nonce. To revoke one grant they call `DelegationManager.disableDelegation`.

Caveats per name, in order: `AllowedTargets [AGTResolver]`, `AllowedMethods [chosen setters]`, `ValueLte 0`, `AllowedCalldata (arg0 == node)`, `Timestamp`, `LimitedCalls`, `Redeemer [session]`, `Nonce`.

## Install

```
npm install @agtnames/countersign
```

## CLI

```
# owner: build and sign a grant for a session key (key read from an env var, never an argument)
OWNER_KEY=0x… agt-countersign build --chain 137 --owner 0xOWNER --session 0xSESSION \
  --names notary,envoy --actions text,endpoint --ttl 1h --calls 5 --sign-with-key OWNER_KEY --out grant.json

# owner with a browser wallet: print EIP-712 payloads, sign them in the wallet, attach the signatures
agt-countersign build … --typed-data > unsigned.json
agt-countersign sign grant.json --signatures 0xSIG1,0xSIG2

# anyone: read the mandate offline, or the live state
agt-countersign describe grant.json
agt-countersign status grant.json

# owner: revoke every outstanding grant
OWNER_KEY=0x… agt-countersign revoke-all --chain 137 --owner-key OWNER_KEY
```

## Library

```ts
import { buildGrant, signGrantWithKey, describeGrant, redeem, grantStatus } from "@agtnames/countersign";

const grant = await signGrantWithKey(
  buildGrant({ chainId: 137, delegator: owner, delegate: session, names: ["notary"], actions: ["text", "endpoint"], ttlSeconds: 3600, maxCalls: 5, nonce }),
  ownerPrivateKey,
);
const d = await describeGrant(grant);          // d.ok, d.problems, d.summary (plain language, one line per enforced fact)
await redeem(grant, "notary", { action: "text", key: "url", value: "https://…" }, { session: sessionPrivateKey });
await grantStatus(grant);                       // calls used per name, expiry, whether the owner revoked, session gas
```

`nonce` is the owner's current `NonceEnforcer.currentNonce(delegationManager, owner)`; the CLI reads it for you.

## What a grant cannot do

- Move POL or tokens (the scope's value cap is zero).
- Call the registry (transfers, approvals, `setResolver`) or the controller (register, renew).
- Touch a name that is not in the grant, even if the same owner holds it.
- Outlive its expiry, exceed its call count, be redeemed by another key, or survive the owner's nonce bump.
- Sign a manifest. The manifest document is still signed by the owner's key; a grant can only move the on-chain pointer to it.

## MCP

`@agtnames/mcp` 1.2+ exposes these as opt-in tools (`agt_session_new`, `agt_session_import`, `agt_session_status`, `agt_session_forget`, `agt_set_text`, `agt_set_addr`, `agt_set_endpoint`, `agt_set_manifest_uri`, `agt_set_wallet`) when `AGT_SESSION_PASSPHRASE` is set. The session key is stored encrypted under `AGT_SESSION_DIR` and never leaves the machine.

## Security notes

- Caveats bound a compromised running agent; the encryption at rest only protects the key file itself.
- Show the grant's `hash` and `describeGrant().summary` to the owner before they sign, and again on import. A wallet's typed-data prompt is a phishing surface; the hash is how a user compares what they were shown with what they signed.
- Framework addresses (DelegationManager, enforcers) come from `@metamask/smart-accounts-kit` 2.0.0 and are identical on 137 and 80002. `describeGrant` refuses a grant whose `delegationManager` differs.

License MIT.
