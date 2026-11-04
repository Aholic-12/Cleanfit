import { ERROR_CODES, createSDKError } from "../utils/errors.js";
import { isClientTokenJwt, mapClientTokenClaims } from "./claims.js";
//#region src/tokens/verify.ts
const PLATFORM_URL = "https://platform.decart.ai";
let jose;
const jwkSets = /* @__PURE__ */ new Map();
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
async function verifyClientToken(token, options = {}) {
	if (!isClientTokenJwt(token)) throw createSDKError(ERROR_CODES.TOKEN_INVALID, "Invalid client token: not a JWT", { reason: "malformed" });
	if (!globalThis.crypto?.subtle) throw createSDKError(ERROR_CODES.UNSUPPORTED_PLATFORM_FEATURE, "verifyClientToken needs WebCrypto (crypto.subtle), which this runtime does not provide. Verify client tokens on your server; decodeClientToken works everywhere.", { feature: "verifyClientToken" });
	const jwksUrl = options.jwksUrl ?? `${PLATFORM_URL}/api/auth/jwks`;
	if (!jose) jose = import("jose");
	const { jwtVerify, createRemoteJWKSet, errors } = await jose;
	let jwkSet = jwkSets.get(jwksUrl);
	if (!jwkSet) {
		jwkSet = createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 6e4 });
		jwkSets.set(jwksUrl, jwkSet);
	}
	try {
		const { payload } = await jwtVerify(token, jwkSet, {
			algorithms: ["EdDSA"],
			issuer: options.issuer ?? PLATFORM_URL,
			audience: options.audience ?? PLATFORM_URL,
			clockTolerance: options.clockTolerance ?? 60,
			requiredClaims: ["exp", "sub"]
		});
		return mapClientTokenClaims(payload);
	} catch (error) {
		const cause = error instanceof Error ? error : void 0;
		const { code = "unknown", claim } = cause ?? {};
		const data = {
			reason: code,
			...claim ? { claim } : {}
		};
		if (error instanceof errors.JWTExpired) throw createSDKError(ERROR_CODES.TOKEN_EXPIRED, `Client token expired: ${cause?.message}`, data, cause);
		if (!(!(error instanceof errors.JOSEError) || /^ERR_(JOSE_GENERIC|JWKS_INVALID|JWKS_TIMEOUT)$/.test(code))) throw createSDKError(ERROR_CODES.TOKEN_INVALID, `Invalid client token: ${cause?.message}`, data, cause);
		throw createSDKError(ERROR_CODES.TOKEN_VERIFY_ERROR, `Could not load the client-token JWKS from ${jwksUrl}: ${cause?.message ?? String(error)}`, {
			...data,
			jwksUrl
		}, cause);
	}
}
//#endregion
export { verifyClientToken };
