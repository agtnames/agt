import type { OnNameLookupHandler } from "@metamask/snaps-sdk";
import { lookupDomain } from "./resolve";

/**
 * MetaMask calls this for every `.agt` input in the send field on a supported chain (see snap.manifest.json).
 * Domain → address only in v1; address → domain (reverse lookup) returns null until v1.1.
 * @param request - The name-lookup request from MetaMask.
 * @param request.chainId - CAIP-2 id of the network selected in the wallet.
 * @param request.domain - The text typed in the send field (undefined for a reverse lookup).
 * @returns The resolved addresses for the name, or null when there is nothing to show.
 */
export const onNameLookup: OnNameLookupHandler = async ({ chainId, domain }) => {
  if (!domain) return null;
  return lookupDomain(domain, chainId);
};
