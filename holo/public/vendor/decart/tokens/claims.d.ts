import { Model } from "../shared/model.js";

//#region src/tokens/claims.d.ts

/**
 * Client-token claims mapped to SDK names. Trusted when returned by `verifyClientToken` /
 * `client.tokens.verify`; UNTRUSTED when returned by `decodeClientToken` / `client.tokens.decode`.
 */
type ClientTokenClaims = {
  /** `metadata.service_tier` at mint time (`0` is the free tier); `null` when unset. */
  serviceTier: number | null;
  /** `"free"` when `serviceTier` is `0`, otherwise `"paid"`. */
  pool: "free" | "paid";
  /** `sub` — the owning user (the organization owner for org tokens). */
  userId: string;
  organizationId: string | null;
  apiKeyName: string | null;
  /** Parent permanent key id when present, else the ephemeral key's own id (`jti`). */
  apiKeyId: string | null;
  /** `null` = unrestricted. */
  allowedModels: (Model | (string & {}))[] | null;
  /** `null` = unrestricted. */
  allowedOrigins: string[] | null;
  /** ISO 8601, like `CreateTokenResponse.expiresAt`. */
  expiresAt: string;
  /** `null` when the owning key is exempt from the limit. */
  realtimeConcurrentSessionLimit: number | null;
  zeroDataRetention: boolean;
  attribution: Record<string, string> | null;
  /** The full JWT payload, for anything not mapped above. */
  raw: Record<string, unknown>;
};
/** JOSE header prefix plus three segments; opaque `ek_*` / `dct_*` keys never match. */

/**
 * Read a client token's claims WITHOUT verifying it — no network, no crypto, so it works everywhere
 * including React Native. The result is UNTRUSTED: use it for display or logging, never for
 * authorization (use `verifyClientToken` / `client.tokens.verify` for that).
 *
 * @throws `TOKEN_INVALID` when the string is not a JWT or the payload is malformed.
 */
declare function decodeClientToken(token: string): ClientTokenClaims;
//#endregion
export { ClientTokenClaims, decodeClientToken };