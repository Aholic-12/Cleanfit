import { ERROR_CODES, createInvalidApiKeyError, createInvalidBaseUrlError, createSDKError } from "./utils/errors.js";
import { createFilesClient } from "./files/client.js";
import { createProcessClient } from "./process/client.js";
import { createQueueClient } from "./queue/client.js";
import { createCredentialSource } from "./realtime/credential.js";
import { createTokensClient } from "./tokens/client.js";
import { readEnv } from "./utils/env.js";
import { createConsoleLogger } from "./utils/logger.js";
import { z } from "zod";
//#region src/create-client.ts
const proxySchema = z.union([z.string().url(), z.string().startsWith("/")]);
const decartClientOptionsSchema = z.object({
	apiKey: z.string().min(1).optional(),
	apiKeyProvider: z.custom((val) => typeof val === "function").optional(),
	baseUrl: z.url().optional(),
	proxy: proxySchema.optional(),
	integration: z.string().optional(),
	realtimeBaseUrl: z.url().optional()
}).refine((data) => {
	const hasProxy = !!data.proxy;
	const hasApiKey = !!data.apiKey;
	return !(hasProxy && hasApiKey);
}, { message: "Cannot provide both 'proxy' and 'apiKey'. Use 'proxy' for proxy mode or 'apiKey' for direct API access." });
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
const createDecartClientForPlatform = (createRealtime, options = {}) => {
	const parsedOptions = decartClientOptionsSchema.safeParse(options);
	if (!parsedOptions.success) {
		const issue = parsedOptions.error.issues[0];
		if (issue.path.includes("apiKey")) throw createInvalidApiKeyError();
		if (issue.path.includes("apiKeyProvider")) throw createSDKError(ERROR_CODES.INVALID_OPTIONS, "apiKeyProvider must be a function returning a client token's apiKey (a string or a Promise of one).");
		if (issue.path.includes("baseUrl") || issue.path.includes("realtimeBaseUrl")) throw createInvalidBaseUrlError(options[issue.path.includes("realtimeBaseUrl") ? "realtimeBaseUrl" : "baseUrl"]);
		if (issue.path.includes("proxy")) throw createInvalidBaseUrlError(issue.path.includes("proxy") ? options.proxy : void 0);
		throw parsedOptions.error;
	}
	const isProxyMode = "proxy" in parsedOptions.data && !!parsedOptions.data.proxy;
	const apiKey = isProxyMode ? void 0 : ("apiKey" in parsedOptions.data ? parsedOptions.data.apiKey : void 0) ?? readEnv("DECART_API_KEY");
	const { apiKeyProvider } = parsedOptions.data;
	if (!isProxyMode && !apiKey && !apiKeyProvider) throw createInvalidApiKeyError();
	let baseUrl;
	if (isProxyMode && "proxy" in parsedOptions.data && parsedOptions.data.proxy) baseUrl = parsedOptions.data.proxy;
	else baseUrl = parsedOptions.data.baseUrl || "https://api.decart.ai";
	const { integration } = parsedOptions.data;
	const logger = "logger" in options && options.logger ? options.logger : createConsoleLogger("info");
	const telemetryEnabled = !("telemetry" in options && options.telemetry === false);
	const wsBaseUrl = parsedOptions.data.realtimeBaseUrl || "wss://api.decart.ai";
	const realtime = createRealtime({
		publishBaseUrl: wsBaseUrl,
		subscribeBaseUrl: isProxyMode || parsedOptions.data.baseUrl !== void 0 ? baseUrl : wsBaseUrl.replace(/^wss?:\/\//i, "https://"),
		apiKey: apiKey || "",
		apiKeyProvider,
		integration,
		logger,
		telemetryEnabled
	});
	const getApiKey = apiKeyProvider && !isProxyMode ? createCredentialSource({
		apiKey: "",
		apiKeyProvider
	}) : () => apiKey || "";
	const process = createProcessClient({
		baseUrl,
		getApiKey,
		integration
	});
	const queue = createQueueClient({
		baseUrl,
		getApiKey,
		integration
	});
	const tokens = createTokensClient({
		baseUrl,
		getApiKey,
		integration
	});
	const files = createFilesClient({
		baseUrl,
		getApiKey,
		integration
	});
	return {
		realtime: {
			connect: realtime.connect,
			subscribe: realtime.subscribe,
			/**
			* Check whether the user's network can support a real-time session
			* *before* connecting — so you can gate showing the integration.
			*
			* Default (STUN-only): validates WebRTC reachability (UDP egress / TURN
			* need) and approximate latency via a throwaway peer connection — no
			* session, instant. Opt-in deep probe (`{ deep: true, model }`): briefly
			* opens a real session with a synthetic source and measures *true*
			* glass-to-glass latency (plus upstream loss/jitter),
			* then tears it down — accurate, but costs a short GPU session.
			*
			* @example
			* ```ts
			* // Fast, pre-session reachability check
			* const { quality, reasons } = await client.realtime.checkConnectivity();
			* if (quality === "critical") showFallbackUI(reasons);
			*
			* // Accurate, measured glass-to-glass verdict
			* const probe = await client.realtime.checkConnectivity({ deep: true, model: models.realtime("lucy-restyle-2") });
			* console.log(probe.metrics.g2gMs);
			* ```
			*/
			checkConnectivity: realtime.checkConnectivity
		},
		/**
		* Client for synchronous image generation.
		* Only image models support the sync/process API.
		*
		* @example
		* ```ts
		* const client = createDecartClient({ apiKey: "your-api-key" });
		* const result = await client.process({
		*   model: models.image("lucy-pro-i2i"),
		*   prompt: "Transform into anime style",
		*   data: imageBlob
		* });
		* ```
		*/
		process,
		/**
		* Client for queue-based async video generation.
		* Only video models support the queue API.
		* Jobs are submitted and processed asynchronously.
		*
		* @example
		* ```ts
		* const client = createDecartClient({ apiKey: "your-api-key" });
		*
		* // Option 1: Submit and poll automatically
		* const result = await client.queue.submitAndPoll({
		*   model: models.video("lucy-latest"),
		*   prompt: "Transform into anime style",
		*   data: videoBlob,
		*   onStatusChange: (job) => console.log(`Job ${job.job_id}: ${job.status}`)
		* });
		*
		* // Option 2: Submit and poll manually
		* const job = await client.queue.submit({
		*   model: models.video("lucy-latest"),
		*   prompt: "Transform into anime style",
		*   data: videoBlob
		* });
		*
		* // Poll until completion
		* while (true) {
		*   const status = await client.queue.status(job.job_id);
		*   console.log(`Job ${status.job_id}: ${status.status}`);
		*
		*   if (status.status === "completed") {
		*     const blob = await client.queue.result(job.job_id);
		*     break;
		*   }
		*   if (status.status === "failed") {
		*     throw new Error("Job failed");
		*   }
		*   await new Promise(resolve => setTimeout(resolve, 1500));
		* }
		* ```
		*/
		queue,
		/**
		* Client for creating, verifying and decoding client tokens.
		* Client tokens are short-lived API keys safe for client-side use.
		*
		* @example
		* ```ts
		* // Server-side: Create a client token
		* const serverClient = createDecartClient({ apiKey: process.env.DECART_API_KEY });
		* const token = await serverClient.tokens.create();
		* // Returns: { apiKey: "ek_...", token: "eyJ...", expiresAt: "2024-12-15T12:10:00Z" }
		*
		* // Server-side: Verify a client token offline (JWKS) and read its claims
		* const claims = await serverClient.tokens.verify(token.token);
		* console.log(claims.serviceTier, claims.pool, claims.organizationId);
		*
		* // Client-side: Use the client token (mint it right before connecting: the default TTL is 60 s)
		* const client = createDecartClient({ apiKey: token.apiKey });
		* const realtimeClient = await client.realtime.connect(stream, options);
		*
		* // Or let the SDK fetch a fresh token before every request, connect and reconnect
		* const client = createDecartClient({ apiKeyProvider: () => fetchClientTokenFromYourServer() });
		* ```
		*/
		tokens,
		/**
		* Upload files once and reuse them across generations.
		*
		* @example
		* ```ts
		* const ref = await client.files.upload(blob);
		* await rt.set({ image: ref.id, prompt: "make it cinematic" });
		* await rt.set({ image: ref.id, prompt: "now in noir" });
		* ```
		*/
		files
	};
};
//#endregion
export { createDecartClientForPlatform };
