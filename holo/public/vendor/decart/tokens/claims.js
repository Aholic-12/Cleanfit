import { ERROR_CODES, createSDKError } from "../utils/errors.js";
//#region src/tokens/claims.ts
/** JOSE header prefix plus three segments; opaque `ek_*` / `dct_*` keys never match. */
const isClientTokenJwt = (credential) => typeof credential === "string" && credential.startsWith("eyJ") && credential.split(".").length === 3;
const invalid = (message, data) => createSDKError(ERROR_CODES.TOKEN_INVALID, `Invalid client token: ${message}`, data);
/** An integer (not a boolean) or an integer string, else `null`. */
const parseServiceTier = (raw) => typeof raw === "number" && Number.isInteger(raw) ? raw : typeof raw === "string" && /^\s*[+-]?\d+\s*$/.test(raw) ? Number.parseInt(raw, 10) : null;
const str = (value) => typeof value === "string" ? value : null;
const strArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
/** Map a raw JWT payload to {@link ClientTokenClaims}. Requires `sub` and `exp`. */
function mapClientTokenClaims(raw) {
	if (typeof raw.sub !== "string" || !raw.sub) throw invalid("missing `sub` claim", { claim: "sub" });
	if (typeof raw.exp !== "number") throw invalid("missing `exp` claim", { claim: "exp" });
	const serviceTier = parseServiceTier(raw.service_tier) ?? (raw.priority ? 3 : null);
	const attribution = raw.attribution;
	return {
		serviceTier,
		pool: serviceTier === 0 ? "free" : "paid",
		userId: raw.sub,
		organizationId: str(raw.organizationId),
		apiKeyName: str(raw.api_key_name),
		apiKeyId: str(raw.parent_api_key_id) ?? str(raw.jti),
		allowedModels: strArray(raw.models),
		allowedOrigins: strArray(raw.origins),
		expiresAt: (/* @__PURE__ */ new Date(raw.exp * 1e3)).toISOString(),
		realtimeConcurrentSessionLimit: typeof raw.realtimeConcurrentSessionLimit === "number" ? raw.realtimeConcurrentSessionLimit : null,
		zeroDataRetention: raw.zeroDataRetention === true,
		attribution: typeof attribution === "object" && attribution !== null && !Array.isArray(attribution) ? attribution : null,
		raw
	};
}
/**
* Read a client token's claims WITHOUT verifying it — no network, no crypto, so it works everywhere
* including React Native. The result is UNTRUSTED: use it for display or logging, never for
* authorization (use `verifyClientToken` / `client.tokens.verify` for that).
*
* @throws `TOKEN_INVALID` when the string is not a JWT or the payload is malformed.
*/
function decodeClientToken(token) {
	if (!isClientTokenJwt(token)) throw invalid("not a JWT", { reason: "malformed" });
	let payload;
	try {
		const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
		const utf8 = atob(base64).replace(/[\s\S]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
		payload = JSON.parse(decodeURIComponent(utf8));
	} catch {
		throw invalid("payload is not base64url JSON", { reason: "malformed" });
	}
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw invalid("payload is not a JSON object", { reason: "malformed" });
	return mapClientTokenClaims(payload);
}
//#endregion
export { decodeClientToken, isClientTokenJwt, mapClientTokenClaims };
