import { Logger } from "./utils/logger.js";
import { ApiKeyProvider } from "./realtime/credential.js";

//#region src/create-client.d.ts
type DecartClientOptions = {
  proxy: string;
  apiKey?: never;
  apiKeyProvider?: ApiKeyProvider;
  baseUrl?: string;
  realtimeBaseUrl?: string;
  integration?: string;
  logger?: Logger;
  telemetry?: boolean;
} | {
  proxy?: never;
  apiKey?: string;
  apiKeyProvider?: ApiKeyProvider;
  baseUrl?: string;
  realtimeBaseUrl?: string;
  integration?: string;
  logger?: Logger;
  telemetry?: boolean;
};
/**
 * Create a Decart API client.
 *
 * @param options - Configuration options
 * @param options.proxy - URL of the proxy server. When set, the client will use the proxy instead of direct API access and apiKey is not required.
 * @param options.apiKey - API key for authentication.
 * @param options.apiKeyProvider - Called before every HTTP request (including each `submitAndPoll` status poll) and
 *   every realtime connect and reconnect for a fresh credential (a client token's `apiKey`), so a token minted on page
 *   load is never sent after it expired. Wins over `apiKey`; not called for HTTP requests in proxy mode. The API
 *   checks the token once the request body has fully arrived, so for uploads mint it with an `expiresIn` that covers
 *   the upload.
 * @param options.baseUrl - Override the default API base URL.
 * @param options.realtimeBaseUrl - Override the default WebSocket base URL for realtime connections.
 * @param options.integration - Optional integration identifier.
 *
 * Realtime media uses LiveKit only (inference must enable it in `TRANSPORTS_ENABLED`).
 *
 * @example
 * ```ts
 * // Option 1: Explicit API key (direct API access)
 * const client = createDecartClient({ apiKey: "your-api-key" });
 *
 * // Option 2: Using DECART_API_KEY environment variable
 * const client = createDecartClient();
 *
 * // Option 3: Using proxy (client-side, no API key needed)
 * const client = createDecartClient({ proxy: "https://your-server.com/api/decart" });
 *
 * // Option 4: A fresh client token for every request, realtime connect and reconnect
 * const client = createDecartClient({
 *   apiKeyProvider: async () => (await (await fetch("/api/realtime-token", { method: "POST" })).json()).apiKey,
 * });
 * ```
 */
//#endregion
export { DecartClientOptions };