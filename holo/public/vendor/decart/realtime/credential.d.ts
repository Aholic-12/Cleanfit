//#region src/realtime/credential.d.ts
/**
 * Returns the credential for the next HTTP request or realtime dial: a client token's `apiKey`
 * (minted on your server with `client.tokens.create`) or a permanent key. The SDK calls it right
 * before every request, connect and reconnect, so each carries a token minted for it instead of one
 * from page load. For uploads, mint with an `expiresIn` that covers the upload: the API checks the
 * token once the request body has fully arrived.
 *
 * A rejection rejects the call with the same error. During reconnects a rejection is retried like
 * any other dial failure.
 */
type ApiKeyProvider = () => string | Promise<string>;
/**
 * Refuse a client token the server is certain to refuse: a JWT whose `exp` is already in the past,
 * beyond the clock-skew tolerance. Opaque keys and JWTs that do not decode pass through for the
 * server to judge.
 *
 * @throws `TOKEN_EXPIRED`
 */
//#endregion
export { ApiKeyProvider };