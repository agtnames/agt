// End-to-end through the Snap runtime (@metamask/snaps-jest serves dist/bundle.js; `npm test` builds first).
import { describe, expect, it } from "@jest/globals";
import { installSnap } from "@metamask/snaps-jest";
import type { ChainId } from "@metamask/snaps-sdk";

const POLYGON = "eip155:137" as ChainId;
const LIVE = process.env.AGT_LIVE_TEST === "1";

describe("onNameLookup", () => {
  it("answers null for a reverse (address) lookup", async () => {
    const { onNameLookup } = await installSnap();
    const response = await onNameLookup({ chainId: POLYGON, address: "0x37007A1C233F00b423BC0d177AC5B50CA9417596" });
    expect(response).toRespondWith(null);
  });

  it("answers null for a domain that is not a .agt label, and on an unsupported chain", async () => {
    const { onNameLookup } = await installSnap();
    expect(await onNameLookup({ chainId: POLYGON, domain: "vitalik.eth" })).toRespondWith(null);
    expect(await onNameLookup({ chainId: "eip155:11155111" as ChainId, domain: "launchpad.agt" })).toRespondWith(null);
  });

  // Live: reads Polygon mainnet through the bundled resolver (AGT_LIVE_TEST=1). launchpad.agt has addr == agentWallet.
  (LIVE ? it : it.skip)("resolves launchpad.agt on Polygon and on Base to its on-chain addr", async () => {
    const { onNameLookup } = await installSnap();
    const expected = { resolvedAddresses: [{ resolvedAddress: "0x37007A1C233F00b423BC0d177AC5B50CA9417596", protocol: "AGT Registry", domainName: "launchpad.agt" }] };
    expect(await onNameLookup({ chainId: POLYGON, domain: "Launchpad.agt" })).toRespondWith(expected);
    expect(await onNameLookup({ chainId: "eip155:8453" as ChainId, domain: "launchpad.agt" })).toRespondWith(expected);
    expect(await onNameLookup({ chainId: POLYGON, domain: "definitely-not-registered-xyz.agt" })).toRespondWith(null);
  });
});
