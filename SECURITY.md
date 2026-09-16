# Security policy — .agt Registry v2

AGT Domains LLC operates the `.agt` agent-name registry: the AGT Registry v2 contracts on Polygon, agtnames.com, the `@agtnames/resolver` and `@agtnames/mcp` packages, and the hosted-manifest service at agts.dev. This document is the public half of the no-audit posture recorded in `DECISIONS.md` D-013 and D-024: the contracts shipped without a third-party audit and without a paid bug bounty. In exchange we keep an on-chain pause the multisig can pull instantly, put every privileged change behind a public 48-hour delay, publish this policy, and credit researchers publicly.

## Reporting

Email **security@agtnames.com**. Include the affected contract or URL, reproduction steps, and the impact you believe is possible. We acknowledge within 2 business days and give a triage decision within 7. Please do not open a public issue for anything exploitable, and do not test against other people's names or funds; use Polygon Amoy (`AGT_CHAIN_ID=80002`, addresses in `docs/technical-reference.md`) for anything that mints, renews or pays.

## Scope

In scope:

- `contracts/contracts/launch/*` as deployed on Polygon mainnet (registry, controller, resolver, migration claim, renderer, timelock): the proxy addresses are published on `/docs/architecture`.
- agtnames.com API routes that move money or mint: `/api/checkout`, `/api/webhooks/stripe`, `/api/v2/quote`, `/api/cron/*`, `/api/admin/*`, `/api/v2/manifest/pin`.
- `@agtnames/resolver`, `@agtnames/mcp` and the Claude Code plugin: anything that lets a name owner's published data execute instructions or exfiltrate data on a client.

Out of scope: denial of service, rate-limit findings without a security consequence, issues in third-party services (Stripe, Vercel, Neon, Pinata, Polygon RPCs), social engineering, the contents of a name owner's own manifest, and anything already tracked publicly in the issue tracker.

## Recognition

There is **no paid bug bounty** at this stage (owner decision, D-024, 2026-09-16). What we do offer:

- A named credit in `CHANGELOG.md` and in the fix's release note, or anonymity if you prefer.
- A free perpetual `.agt` name of your choosing (subject to the reserved and blocked lists) for any confirmed High or Critical finding.
- Coordinated disclosure: we agree a publication date with you once the fix has cleared the timelock.

Severity is judged by us on impact: **Critical** — mint or transfer any `.agt` without paying or without the owner's key, drain the relayer or treasury, bypass the timelock. **High** — mint below the table price with a validly-signed quote, permanently break resolution or renewal for names you do not own, forge a verified manifest. **Medium** — replay or farm signed quotes beyond the ledger cap, make the indexer or hosted manifests serve another owner's data, pause bypass. **Low** — information leaks in admin/cron surfaces, misleading but non-exploitable state.

If a paid programme is introduced later it will be announced here and in the changelog; findings reported before that date are not retroactively paid.

## Upgrade and admin policy

- **Who can change what.** The registry and controller are UUPS proxies. `DEFAULT_ADMIN_ROLE` and `UPGRADER_ROLE` on both belong to `AGTTimelock`; the timelock's proposer and executor is the AGT Domains LLC Safe. The Safe alone holds `PAUSER_ROLE` (instant) and sets the migration allowlist root. No individual key can upgrade, re-price or re-assign a name.
- **Delay.** The timelock ran at 1 hour during the claims-only launch period (published with the addresses, D-018) and is raised to **48 hours before the first paid registration**. Every scheduled operation is visible on-chain (`CallScheduled`) for the full delay before it can execute.
- **Announcements.** Any upgrade, price-floor change, treasury or resolver change is posted to the changelog and the `launchpad.agt` manifest at scheduling time, with the operation id, and again at execution.
- **What upgrades never do.** Ownership records are never rewritten by an upgrade. Perpetual status recorded on a token cannot be revoked. A pause stops registration, renewal and transfers but never resolution.
- **Emergency.** If a pause is used, the reason is published within 24 hours and the fix goes through the same 48-hour timelock; we do not shorten the delay to ship a fix.

## Keys

Hot keys (`QUOTE_SIGNER_ROLE`, `RELAYER_ROLE`) are dedicated, rotatable through the timelock, hold no admin rights, and are monitored (balance, role presence) by the hourly health cron. The deployer holds no roles. Operator copies exist only encrypted at rest.
