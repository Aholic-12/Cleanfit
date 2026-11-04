//#region src/utils/errors.d.ts
type DecartSDKError = {
  code: string;
  message: string;
  data?: Record<string, unknown>;
  cause?: Error;
};
declare const ERROR_CODES: {
  readonly INVALID_API_KEY: "INVALID_API_KEY";
  readonly INVALID_BASE_URL: "INVALID_BASE_URL";
  readonly PROCESSING_ERROR: "PROCESSING_ERROR";
  readonly INVALID_INPUT: "INVALID_INPUT";
  readonly INVALID_OPTIONS: "INVALID_OPTIONS";
  readonly MODEL_NOT_FOUND: "MODEL_NOT_FOUND";
  readonly QUEUE_SUBMIT_ERROR: "QUEUE_SUBMIT_ERROR";
  readonly QUEUE_STATUS_ERROR: "QUEUE_STATUS_ERROR";
  readonly QUEUE_RESULT_ERROR: "QUEUE_RESULT_ERROR";
  readonly JOB_NOT_COMPLETED: "JOB_NOT_COMPLETED";
  readonly TOKEN_CREATE_ERROR: "TOKEN_CREATE_ERROR";
  /** Client-token verification: the token is not a valid, correctly signed Decart client token. */
  readonly TOKEN_INVALID: "TOKEN_INVALID";
  /** Client-token verification: signature is fine but `exp` is in the past (beyond clock tolerance). */
  readonly TOKEN_EXPIRED: "TOKEN_EXPIRED";
  /** Client-token verification could not run, e.g. the JWKS could not be fetched. Says nothing about the token. */
  readonly TOKEN_VERIFY_ERROR: "TOKEN_VERIFY_ERROR";
  readonly FILES_UPLOAD_ERROR: "FILES_UPLOAD_ERROR";
  readonly FILES_GET_ERROR: "FILES_GET_ERROR";
  readonly FILES_DELETE_ERROR: "FILES_DELETE_ERROR";
  readonly REACT_NATIVE_SETUP_REQUIRED: "REACT_NATIVE_SETUP_REQUIRED";
  readonly UNSUPPORTED_PLATFORM_FEATURE: "UNSUPPORTED_PLATFORM_FEATURE";
  readonly LIVEKIT_INITIALIZATION_ERROR: "LIVEKIT_INITIALIZATION_ERROR";
  readonly WEBRTC_WEBSOCKET_ERROR: "WEBRTC_WEBSOCKET_ERROR";
  readonly WEBRTC_ICE_ERROR: "WEBRTC_ICE_ERROR";
  readonly WEBRTC_TIMEOUT_ERROR: "WEBRTC_TIMEOUT_ERROR";
  readonly WEBRTC_SERVER_ERROR: "WEBRTC_SERVER_ERROR";
  readonly WEBRTC_SIGNALING_ERROR: "WEBRTC_SIGNALING_ERROR";
};
//#endregion
export { DecartSDKError, ERROR_CODES };