/**
 * @agtnames/countersign — scoped session grants for .agt owners (D-025 v2).
 *
 * A grant is a bundle of per-name delegations that lets a session key perform chosen AGTResolver record writes
 * on chosen names until an expiry, at most N times per name, revocable in one transaction. Every line of the
 * summary is a caveat the chain enforces. The package never holds keys: callers pass the session key to `redeem`.
 */
export { ACTIONS, ACTION_IDS, isActionId, resolverAbi, type ActionDef, type ActionId } from "./actions.js";
export {
  GRANT_VERSION, SUPPORTED_CHAINS, GrantError, buildGrant, attachSignatures, signGrantWithKey, delegationTypedData,
  encodeGrant, decodeGrant, describeGrant, grantHash, canonicalUnsigned, saltFor, environmentFor, defaultResolver, enforcerName,
  type GrantV1, type GrantName, type BuildGrantInput, type GrantDescription, type SupportedChainId,
} from "./grant.js";
export { redeem, grantStatus, encodeAction, RedeemError, DEFAULT_RPC, type ActionArgs, type RedeemOptions, type GrantStatus, type NameStatus } from "./redeem.js";
export const VERSION = "0.1.0";
