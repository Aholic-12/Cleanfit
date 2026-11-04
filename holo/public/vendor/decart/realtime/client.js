import { DecartSDKException, classifyWebrtcError } from "../utils/errors.js";
import { createCredentialSource } from "./credential.js";
import { createConsoleLogger } from "../utils/logger.js";
import { isFileRefId } from "../files/types.js";
import { modelDefinitionSchema, realtimeSpeedSchema, resolveFpsNumber } from "../shared/model.js";
import { modelStateSchema } from "../shared/types.js";
import { imageToBase64 } from "../utils/media.js";
import { createEventBuffer } from "./event-buffer.js";
import { realtimeMethods } from "./methods.js";
import { StreamSession } from "./stream-session.js";
import { z } from "zod";
//#region src/realtime/client.ts
const realTimeClientInitialStateSchema = modelStateSchema;
const realTimeClientConnectOptionsSchema = z.object({
	model: modelDefinitionSchema,
	onRemoteStream: z.custom((val) => typeof val === "function", { message: "onRemoteStream must be a function" }),
	onConnectionChange: z.custom((val) => typeof val === "function", { message: "onConnectionChange must be a function" }).optional(),
	onConnectionQuality: z.custom((val) => typeof val === "function", { message: "onConnectionQuality must be a function" }).optional(),
	onQueuePosition: z.custom((val) => typeof val === "function", { message: "onQueuePosition must be a function" }).optional(),
	/**
	* Called each time the server refuses a dial for lack of capacity and `connect()` is about to wait
	* for the server's `retry_after` before dialling again. Only fires while `connect()` is pending.
	*/
	onCapacityWait: z.custom((val) => typeof val === "function", { message: "onCapacityWait must be a function" }).optional(),
	initialState: realTimeClientInitialStateSchema.optional(),
	queryParams: z.record(z.string(), z.string()).optional(),
	mirror: z.union([z.literal("auto"), z.boolean()]).optional(),
	resolution: z.enum(["720p", "1080p"]).optional(),
	/**
	* Realtime speed tier. Fast mode (`"fast"`) serves the session from a higher-compute tier for lower
	* latency and higher throughput; output quality is unchanged. It is currently available for `lucy-2.6`,
	* `lucy-2.5` / `lucy-latest` and `lucy-vton-3.6` / `lucy-vton-3.5` / `lucy-vton-latest`, in the US region
	* only, and is billed at 2x the standard realtime rate for those models. Other models ignore the option (the
	* SDK logs a warning when the model does not list it in `supportedSpeeds`). Omit it (the default) for
	* standard mode.
	*/
	speed: realtimeSpeedSchema.optional(),
	/**
	* How many times a failed connect is re-dialled before `connect()` rejects (default 5, exponential
	* backoff from 1 s to 10 s). `0` dials exactly once. Apps that hand out connects from their own session
	* queue should pass `0`: every retry is a fresh dial that competes with the people waiting in line.
	* Refusals the server will not change its mind about (policy close 1008, concurrent-session limit
	* 1013 "Session Limit Reached") are never retried regardless. Does not affect the automatic
	* reconnect after an established session drops. A capacity refusal (`error_type: "capacity"`) is
	* re-dialled after the server's `retry_after` instead, bounded by `capacityRetryBudgetMs` rather
	* than by this count; `0` turns those re-dials off too.
	*/
	retries: z.number().int().min(0).optional(),
	/**
	* How long after its first dial a `connect()` keeps re-dialling capacity refusals, in ms (default
	* 60 000). Once spent, `connect()` rejects with the server's capacity error.
	*/
	capacityRetryBudgetMs: z.number().min(0).optional(),
	/** Local track publish codec. Desktop Safari is always pinned to vp8 and ignores this value. */
	preferredVideoCodec: z.enum([
		"h264",
		"vp8",
		"vp9"
	]).optional(),
	/**
	* @deprecated Glass-to-glass measurement now runs automatically in browsers
	* when LiveKit frame metadata is available. This legacy flag is accepted for
	* compatibility and no longer gates measurement.
	*/
	debugQuality: z.boolean().optional()
});
const createRealTimeClient = (opts) => {
	const { baseUrl, integration } = opts;
	const logger = opts.logger ?? createConsoleLogger("info");
	const nextCredential = createCredentialSource({
		apiKey: opts.apiKey,
		apiKeyProvider: opts.apiKeyProvider
	});
	const connect = async (stream, options) => {
		const parsedOptions = realTimeClientConnectOptionsSchema.safeParse(options);
		if (!parsedOptions.success) throw parsedOptions.error;
		const { onRemoteStream, onConnectionChange, onConnectionQuality, onQueuePosition, onCapacityWait, initialState, queryParams: extraQueryParams, resolution, speed, retries, capacityRetryBudgetMs, preferredVideoCodec } = parsedOptions.data;
		const mirror = parsedOptions.data.mirror ?? false;
		let session;
		let observability;
		let preparedConnection;
		try {
			const initialImageRef = isFileRefId(initialState?.image) ? initialState.image : void 0;
			const [credential, initialImage] = await Promise.all([nextCredential(), initialImageRef === void 0 && initialState?.image ? imageToBase64(initialState.image) : void 0]);
			const initialPrompt = initialState?.prompt ? {
				text: initialState.prompt.text,
				enhance: initialState.prompt.enhance
			} : void 0;
			const url = `${baseUrl}${options.model.urlPath}`;
			const { emitter: eventEmitter, emitOrBuffer, flush, stop } = createEventBuffer();
			preparedConnection = opts.prepareConnection({
				stream,
				mirror,
				preferredVideoCodec,
				fps: resolveFpsNumber(options.model.fps),
				logger,
				observability: {
					telemetryEnabled: opts.telemetryEnabled,
					apiKey: credential,
					model: options.model.name,
					integration,
					logger,
					onDiagnostic: (event) => emitOrBuffer("diagnostic", event),
					onStats: (stats) => emitOrBuffer("stats", stats),
					onConnectionQuality: (report) => {
						emitOrBuffer("connectionQuality", report);
						onConnectionQuality?.(report);
					}
				}
			});
			observability = preparedConnection.observability;
			if (speed && !options.model.supportedSpeeds?.includes(speed)) logger.warn("realtime: model does not support the requested speed tier; the server serves it at standard speed", {
				model: options.model.name,
				speed,
				supportedSpeeds: options.model.supportedSpeeds ?? []
			});
			const preparedQueryParams = preparedConnection.queryParams;
			const modelName = options.model.name;
			let dialCredential = credential;
			const dialUrl = (apiKey) => {
				dialCredential = apiKey;
				const queryParams = new URLSearchParams({
					...preparedQueryParams,
					...extraQueryParams,
					api_key: apiKey,
					model: modelName,
					...resolution ? { resolution } : {},
					...speed ? { speed } : {}
				});
				return `${url}?${queryParams.toString()}`;
			};
			session = new StreamSession({
				url: dialUrl(credential),
				redialUrl: () => {
					const next = nextCredential();
					return typeof next === "string" ? dialUrl(next) : next.then(dialUrl);
				},
				integration,
				observability,
				frameTiming: preparedConnection.frameTiming,
				localStream: preparedConnection.stream,
				initialImage,
				initialImageRef,
				initialPrompt,
				initialPassthrough: initialState?.passthrough,
				connectRetries: retries,
				capacityRetryBudgetMs,
				logger,
				videoCodec: preparedConnection.videoCodec,
				createMediaChannel: preparedConnection.createMediaChannel
			});
			let sessionId = null;
			let subscribeToken = null;
			session.on("remoteStream", onRemoteStream);
			session.on("connectionChange", (state) => {
				emitOrBuffer("connectionChange", state);
				onConnectionChange?.(state);
			});
			session.on("queuePosition", (qp) => {
				emitOrBuffer("queuePosition", qp);
				onQueuePosition?.(qp);
			});
			session.on("capacityWait", (wait) => onCapacityWait?.(wait));
			session.on("sessionStarted", ({ sessionId: id, subscribeToken: token }) => {
				sessionId = id;
				subscribeToken = token;
				observability?.sessionStarted(id, dialCredential);
			});
			session.on("generationTick", (e) => emitOrBuffer("generationTick", e));
			session.on("generationEnded", (e) => emitOrBuffer("generationEnded", e));
			session.on("sessionEnded", (e) => emitOrBuffer("sessionEnded", e));
			session.on("error", (error) => {
				logger.error("Realtime error", { error: error.message });
				emitOrBuffer("error", classifyWebrtcError(error));
			});
			const activeSession = session;
			await activeSession.connect();
			const client = {
				...realtimeMethods(activeSession, imageToBase64),
				isConnected: () => activeSession.isConnected(),
				getConnectionState: () => activeSession.getConnectionState(),
				getConnectionQuality: () => observability?.getConnectionQuality() ?? null,
				disconnect: () => {
					observability?.stop();
					stop();
					activeSession.disconnect();
					preparedConnection?.dispose();
				},
				on: eventEmitter.on,
				off: eventEmitter.off,
				get sessionId() {
					return sessionId;
				},
				get subscribeToken() {
					return subscribeToken;
				},
				getSubscribeToken: () => subscribeToken,
				setImage: async (image, imgOptions) => {
					if (isFileRefId(image)) return activeSession.setImage({
						kind: "ref",
						ref: image
					}, imgOptions);
					if (image === null) return activeSession.setImage({
						kind: "data",
						data: null
					}, imgOptions);
					const base64 = await imageToBase64(image);
					return activeSession.setImage({
						kind: "data",
						data: base64
					}, imgOptions);
				}
			};
			flush();
			return client;
		} catch (error) {
			observability?.stop();
			session?.disconnect();
			preparedConnection?.dispose();
			throw error instanceof DecartSDKException ? error.sdkError : error;
		}
	};
	return { connect };
};
//#endregion
export { createRealTimeClient };
