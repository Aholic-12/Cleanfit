import { createApiKeyProviderResultError, createClientTokenExpiredError } from "../utils/errors.js";
import { decodeClientToken } from "../tokens/claims.js";
import { REALTIME_CONFIG } from "./config-realtime.js";
//#region src/realtime/credential.ts
/**
* Refuse a client token the server is certain to refuse: a JWT whose `exp` is already in the past,
* beyond the clock-skew tolerance. Opaque keys and JWTs that do not decode pass through for the
* server to judge.
*
* @throws `TOKEN_EXPIRED`
*/
function assertClientTokenNotExpired(credential, now = Date.now()) {
	let expiresAt;
	try {
		({expiresAt} = decodeClientToken(credential));
	} catch {
		return;
	}
	const expiredSecondsAgo = (now - Date.parse(expiresAt)) / 1e3;
	if (expiredSecondsAgo > REALTIME_CONFIG.session.clientTokenExpiryToleranceSeconds) throw createClientTokenExpiredError(Math.round(expiredSecondsAgo), expiresAt);
}
/**
* The per-dial credential: the provider's fresh token when one is set, else the static key, checked
* for expiry either way. Synchronous for a static key, so the first socket still opens in the same
* tick as `connect()`. Provider rejections propagate as they are.
*/
function createCredentialSource(options) {
	const { apiKey, apiKeyProvider } = options;
	if (!apiKeyProvider) return () => {
		assertClientTokenNotExpired(apiKey);
		return apiKey;
	};
	return async () => {
		const credential = await apiKeyProvider();
		if (typeof credential !== "string" || credential.length === 0) throw createApiKeyProviderResultError(credential);
		assertClientTokenNotExpired(credential);
		return credential;
	};
}
//#endregion
export { assertClientTokenNotExpired, createCredentialSource };
