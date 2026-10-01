# @agtnames/cli

The `agt` command: register a `.agt` name, publish its signed manifest, set its records and verify the result, all from a terminal.

```bash
npx @agtnames/cli --help
```

It signs in MetaMask by default. `agt` opens a page on `127.0.0.1` and you approve each signature and transaction in your wallet, so the private key never leaves it. Any browser wallet that injects `window.ethereum` works the same way. For automation, it can also sign with a key from an environment variable or from an encrypted keyfile.

## From nothing to a verified agent

```bash
agt available weather                     # price and availability
agt register weather --years 1            # quote → approve USDC → register, approved in your wallet
agt manifest init weather                 # writes weather.manifest.json to fill in
agt manifest publish weather weather.manifest.json
agt verify weather                        # signer == manifest owner == on-chain owner, endpoints live
```

`register` pays in USDC on Polygon and needs a little POL for gas. The quote the site signs is good for about 15 minutes, so the approval and the registration go out one after the other.

`manifest publish` does four things:

1. checks that every endpoint in the file answers;
2. signs the manifest in your wallet (EIP-191 over the canonical JSON);
3. hosts it at `https://agts.dev/<name>.json`, or on IPFS with `--host ipfs`;
4. sets the on-chain records in one transaction: the manifest pointer, one endpoint per protocol, `addr`, and the agent wallet if the manifest lists a payment address.

Pass `--no-records` to host the document without writing the records.

## Commands

```
agt available <name>
agt register <name> [--years N] [--to 0x…] [--dry-run] [--yes]
agt manifest init <name> [--out file.json]
agt manifest publish <name> <file.json> [--host agts.dev|ipfs] [--no-records] [--skip-live-check] [--dry-run]
agt records set <name> [--mcp URL] [--a2a URL] [--http URL] [--ws URL] [--wallet 0x…] [--addr 0x…] [--manifest URI] [--dry-run]
agt verify <name> [--no-endpoints] [--json]
agt keyfile create <file>
agt keyfile address <file>
```

With `--dry-run`, a write command signs what needs signing, prints the exact document and transactions, and sends nothing. With `--json`, the result goes to stdout as JSON and progress goes to stderr. Exit codes: 0 done, 1 failed or `verify` found a problem, 2 usage error.

## Signing

| How | Flag | Key source |
|---|---|---|
| MetaMask or another browser wallet (default) | none, or `--no-open` to print the page URL | stays in the wallet |
| Environment variable | `--signer key`, or `--key-env NAME` | `AGT_OWNER_KEY`, or the variable you name |
| Encrypted keyfile | `--keyfile owner.json` | passphrase from `AGT_KEYFILE_PASSPHRASE` or a hidden prompt |

A key is never taken from a command-line argument, where it would end up in shell history. `agt keyfile create` reads the key and passphrase at hidden prompts. It uses the same format as `@agtnames/mcp`'s session key: scrypt, then AES-256-GCM, with the address stored in the clear.

The wallet page listens only on `127.0.0.1` under a random path. It refuses requests carrying another Host or Origin, and runs under a strict content security policy. The CLI checks everything that comes back: a signature must recover to the connected account, and the page re-checks the chain and account before each transaction.

## Registering for someone else

`agt register <name> --to 0x…` pays from your wallet and mints the name to another address. Only that address can then publish the manifest or set records. A manifest signed by anyone else shows as unverified.

## Networks

`--network polygon` (the default) or `--network amoy`. `--rpc URL` overrides the RPC endpoint (default: the resolver's public fallback list). `--site URL` overrides where quotes and manifest hosting come from (default `https://agtnames.com`). Amoy has no public site, so pass `--site`, for example a local `next dev`. The same settings can come from `AGT_NETWORK`, `AGT_RPC_URL` and `AGT_SITE`.

## License

MIT
