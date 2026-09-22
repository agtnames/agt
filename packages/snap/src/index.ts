import type { OnNameLookupHandler } from "@metamask/snaps-sdk";
import { lookupDomain } from "./resolve";

/**
 * MetaMask calls this for every `.agt` input in the send field on a supported chain (see snap.manifest.json).
 * Domain → address only in v1; address → domain (reverse lookup) returns null until v1.1.
 */
export const onNameLookup: OnNameLookupHandler = async ({ chainId, domain }) => {
  if (!domain) return null;
  return lookupDomain(domain, chainId);
};
