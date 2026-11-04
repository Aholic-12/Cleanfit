import { ClientTokenClaims } from "./claims.js";

//#region src/tokens/verify.d.ts
type VerifyClientTokenOptions = {
  /** Default `https://platform.decart.ai/api/auth/jwks`. */
  jwksUrl?: string;
  /** Expected `iss`. Default `https://platform.decart.ai`. */
  issuer?: string;
  /** Expected `aud`. Default `https://platform.decart.ai`. */
  audience?: string;
  /** Allowed clock skew in seconds for `exp`. Default 60. */
  clockTolerance?: number;
};
/**
 * Verify a Decart client token OFFLINE and return its claims: EdDSA signature against the
 * platform's public JWKS (fetched once and cached), plus `exp` (with clock tolerance), `iss` and
 * `aud`. This is a local JWKS check, not an API call, and it needs no API key. Requires WebCrypto and `fetch` (Node 20+, Bun, Deno, browsers, Workers, Edge).
 *
 * @throws `TOKEN_INVALID` bad signature, wrong `iss`/`aud`, malformed token or unknown `kid`
 * @throws `TOKEN_EXPIRED` `exp` is in the past
 * @throws `TOKEN_VERIFY_ERROR` the JWKS could not be fetched — the token itself was not judged
 * @throws `UNSUPPORTED_PLATFORM_FEATURE` the runtime has no WebCrypto (e.g. React Native)
 */
declare function verifyClientToken(token: string, options?: VerifyClientTokenOptions): Promise<ClientTokenClaims>;
//#endregion
export { VerifyClientTokenOptions, verifyClientToken };