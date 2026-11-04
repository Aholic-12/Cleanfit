//#region src/utils/errors.ts
const ERROR_CODES = {
	INVALID_API_KEY: "INVALID_API_KEY",
	INVALID_BASE_URL: "INVALID_BASE_URL",
	PROCESSING_ERROR: "PROCESSING_ERROR",
	INVALID_INPUT: "INVALID_INPUT",
	INVALID_OPTIONS: "INVALID_OPTIONS",
	MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
	QUEUE_SUBMIT_ERROR: "QUEUE_SUBMIT_ERROR",
	QUEUE_STATUS_ERROR: "QUEUE_STATUS_ERROR",
	QUEUE_RESULT_ERROR: "QUEUE_RESULT_ERROR",
	JOB_NOT_COMPLETED: "JOB_NOT_COMPLETED",
	TOKEN_CREATE_ERROR: "TOKEN_CREATE_ERROR",
	/** Client-token verification: the token is not a valid, correctly signed Decart client token. */
	TOKEN_INVALID: "TOKEN_INVALID",
	/** Client-token verification: signature is fine but `exp` is in the past (beyond clock tolerance). */
	TOKEN_EXPIRED: "TOKEN_EXPIRED",
	/** Client-token verification could not run, e.g. the JWKS could not be fetched. Says nothing about the token. */
	TOKEN_VERIFY_ERROR: "TOKEN_VERIFY_ERROR",
	FILES_UPLOAD_ERROR: "FILES_UPLOAD_ERROR",
	FILES_GET_ERROR: "FILES_GET_ERROR",
	FILES_DELETE_ERROR: "FILES_DELETE_ERROR",
	REACT_NATIVE_SETUP_REQUIRED: "REACT_NATIVE_SETUP_REQUIRED",
	UNSUPPORTED_PLATFORM_FEATURE: "UNSUPPORTED_PLATFORM_FEATURE",
	LIVEKIT_INITIALIZATION_ERROR: "LIVEKIT_INITIALIZATION_ERROR",
	WEBRTC_WEBSOCKET_ERROR: "WEBRTC_WEBSOCKET_ERROR",
	WEBRTC_ICE_ERROR: "WEBRTC_ICE_ERROR",
	WEBRTC_TIMEOUT_ERROR: "WEBRTC_TIMEOUT_ERROR",
	WEBRTC_SERVER_ERROR: "WEBRTC_SERVER_ERROR",
	WEBRTC_SIGNALING_ERROR: "WEBRTC_SIGNALING_ERROR"
};
function createSDKError(code, message, data, cause) {
	return {
		code,
		message,
		data,
		cause
	};
}
function isDecartSDKError(error) {
	return typeof error === "object" && error !== null && typeof error.code === "string" && typeof error.message === "string";
}
/**
* An `Error` carrying a {@link DecartSDKError} across the realtime session's retry loop, which
* (like p-retry) only accepts real errors. `connect()` and `classifyWebrtcError` unwrap it, so
* callers still receive the plain SDK error.
*/
var DecartSDKException = class extends Error {
	sdkError;
	constructor(sdkError) {
		super(sdkError.message);
		this.name = "DecartSDKException";
		this.sdkError = sdkError;
		if (sdkError.cause) this.cause = sdkError.cause;
	}
};
function createInvalidApiKeyError() {
	return createSDKError(ERROR_CODES.INVALID_API_KEY, "Missing API key. Pass `apiKey` or `apiKeyProvider` to createDecartClient(), or set the DECART_API_KEY environment variable.");
}
/** The platform's default client-token TTL (`tokens.create({ expiresIn })`), quoted in the expiry message. */
const CLIENT_TOKEN_DEFAULT_TTL_SECONDS = 60;
/** An expired client token caught by the realtime preflight, before any dial. */
function createClientTokenExpiredError(expiredSecondsAgo, expiresAt) {
	return createSDKError(ERROR_CODES.TOKEN_EXPIRED, `Client token expired ${expiredSecondsAgo} s ago (exp ${expiresAt}). Mint a new one right before connecting, or pass apiKeyProvider to createDecartClient so the SDK fetches a fresh token before every connect and reconnect. Client tokens expire ${CLIENT_TOKEN_DEFAULT_TTL_SECONDS} s after minting by default (tokens.create({ expiresIn })).`, {
		claim: "exp",
		expiresAt,
		expiredSecondsAgo
	});
}
function createApiKeyProviderResultError(received) {
	const got = received === "" ? "an empty string" : typeof received;
	return createSDKError(ERROR_CODES.INVALID_API_KEY, `apiKeyProvider must resolve to a non-empty API key string (a client token's apiKey); got ${got}.`);
}
function createInvalidBaseUrlError(url) {
	return createSDKError(ERROR_CODES.INVALID_BASE_URL, `Invalid base URL${url ? `: ${url}` : ""}`);
}
function createReactNativeSetupRequiredError(missing) {
	return createSDKError(ERROR_CODES.REACT_NATIVE_SETUP_REQUIRED, "React Native realtime requires @livekit/react-native registerGlobals() before calling Decart realtime APIs.", { missing });
}
function createUnsupportedPlatformFeatureError(feature, platform) {
	return createSDKError(ERROR_CODES.UNSUPPORTED_PLATFORM_FEATURE, `${feature} is not supported on ${platform}.`, {
		feature,
		platform
	});
}
function createLiveKitInitializationError(message, cause) {
	return createSDKError(ERROR_CODES.LIVEKIT_INITIALIZATION_ERROR, message, void 0, cause);
}
function createWebrtcWebsocketError(error) {
	return createSDKError(ERROR_CODES.WEBRTC_WEBSOCKET_ERROR, "WebSocket connection failed", void 0, error);
}
function createWebrtcIceError(error) {
	return createSDKError(ERROR_CODES.WEBRTC_ICE_ERROR, "ICE connection failed", void 0, error);
}
function createWebrtcTimeoutError(phase, timeoutMs, cause) {
	const hasTimeout = typeof timeoutMs === "number" && Number.isFinite(timeoutMs);
	return createSDKError(ERROR_CODES.WEBRTC_TIMEOUT_ERROR, hasTimeout ? `${phase} timed out after ${timeoutMs}ms` : `${phase} timed out`, hasTimeout ? {
		phase,
		timeoutMs
	} : { phase }, cause);
}
function createWebrtcServerError(message) {
	return createSDKError(ERROR_CODES.WEBRTC_SERVER_ERROR, message);
}
function createWebrtcSignalingError(error) {
	return createSDKError(ERROR_CODES.WEBRTC_SIGNALING_ERROR, "Signaling error", void 0, error);
}
/**
* Classify a raw WebRTC error into a specific SDK error based on its message.
*/
function classifyWebrtcError(error) {
	if (error instanceof DecartSDKException) return error.sdkError;
	const msg = error.message.toLowerCase();
	if (error.source === "server") return createWebrtcServerError(error.message);
	if (msg.includes("websocket")) return createWebrtcWebsocketError(error);
	if (msg.includes("ice connection failed")) return createWebrtcIceError(error);
	if (msg.includes("timeout") || msg.includes("timed out")) {
		const timeoutMatch = msg.match(/(\d+)\s*ms/);
		return createWebrtcTimeoutError("connection", timeoutMatch ? Number.parseInt(timeoutMatch[1], 10) : void 0, error);
	}
	return createWebrtcSignalingError(error);
}
function createInvalidInputError(message) {
	return createSDKError(ERROR_CODES.INVALID_INPUT, message);
}
function createModelNotFoundError(model) {
	return createSDKError(ERROR_CODES.MODEL_NOT_FOUND, `Model ${model} not found`);
}
function createQueueSubmitError(message, status) {
	return createSDKError(ERROR_CODES.QUEUE_SUBMIT_ERROR, message, { status });
}
function createQueueStatusError(message, status) {
	return createSDKError(ERROR_CODES.QUEUE_STATUS_ERROR, message, { status });
}
function createQueueResultError(message, status) {
	return createSDKError(ERROR_CODES.QUEUE_RESULT_ERROR, message, { status });
}
//#endregion
export { DecartSDKException, ERROR_CODES, classifyWebrtcError, createApiKeyProviderResultError, createClientTokenExpiredError, createInvalidApiKeyError, createInvalidBaseUrlError, createInvalidInputError, createLiveKitInitializationError, createModelNotFoundError, createQueueResultError, createQueueStatusError, createQueueSubmitError, createReactNativeSetupRequiredError, createSDKError, createUnsupportedPlatformFeatureError, createWebrtcIceError, createWebrtcServerError, createWebrtcSignalingError, createWebrtcTimeoutError, createWebrtcWebsocketError, isDecartSDKError };
