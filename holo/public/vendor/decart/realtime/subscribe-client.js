import { ERROR_CODES, classifyWebrtcError, createSDKError, isDecartSDKError } from "../utils/errors.js";
import { REALTIME_CONFIG } from "./config-realtime.js";
import { createCredentialSource } from "./credential.js";
import { createConsoleLogger } from "../utils/logger.js";
import { createEventBuffer } from "./event-buffer.js";
import { loadLiveKitClient } from "./livekit.js";
import { RealtimeObservability } from "./observability/realtime-observability.js";
//#region src/realtime/subscribe-client.ts
function createFrameMetadataSubscribeUnsupportedError(detail) {
	const suffix = detail ? `: ${detail}` : "";
	return createSDKError(ERROR_CODES.UNSUPPORTED_PLATFORM_FEATURE, `This realtime stream requires LiveKit frame metadata, which this SDK environment does not support${suffix}.`, {
		feature: "LiveKit frame metadata subscribe",
		platform: "this SDK environment"
	});
}
function decodeSubscribeToken(token) {
	try {
		const payload = JSON.parse(atob(token));
		if (!payload.room_name || typeof payload.room_name !== "string") throw new Error("Invalid subscribe token format");
		return {
			room_name: payload.room_name,
			...payload.frame_timing === true ? { frame_timing: true } : {}
		};
	} catch {
		throw new Error("Invalid subscribe token");
	}
}
function mapLiveKitState(state) {
	switch (state) {
		case "connecting": return "connecting";
		case "connected": return "connected";
		case "reconnecting":
		case "signalReconnecting": return "reconnecting";
		case "disconnected": return "disconnected";
		default: return "disconnected";
	}
}
/**
* `stream`'s live tracks plus `track`, as a fresh MediaStream. Consumers assign
* it to an element's `srcObject`, and assigning the same reference is a no-op
* that would leave a late-arriving audio track without a sink; a new object
* makes the element re-read its tracks, so a single <video> plays video and
* audio. Ended tracks (a full reconnect, a republish) are dropped so the
* element never keeps playing a dead one.
*/
function withTrack(stream, track) {
	const tracks = (stream?.getTracks() ?? []).filter((existing) => existing.readyState !== "ended");
	if (!tracks.includes(track)) tracks.push(track);
	return new MediaStream(tracks);
}
async function fetchWatchStreamCredentials(opts) {
	if (!/^https?:\/\//i.test(opts.baseUrl)) throw new Error(`watch-stream baseUrl must use http(s); got ${opts.baseUrl}`);
	const url = `${opts.baseUrl}/watch-stream/${encodeURIComponent(opts.roomName)}`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"x-api-key": opts.apiKey,
			"content-type": "application/json"
		}
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`watch-stream request failed (${res.status}): ${body || res.statusText}`);
	}
	const json = await res.json();
	if (!json.livekit_url || !json.token || !json.room_name) throw new Error("watch-stream response missing required fields");
	return {
		livekit_url: json.livekit_url,
		token: json.token,
		room_name: json.room_name
	};
}
const createRealTimeSubscribeClient = (opts) => {
	const { baseUrl, integration } = opts;
	const logger = opts.logger ?? createConsoleLogger("info");
	const nextCredential = createCredentialSource({
		apiKey: opts.apiKey,
		apiKeyProvider: opts.apiKeyProvider
	});
	const subscribe = async (options) => {
		const { room_name: roomName, frame_timing: frameTiming } = decodeSubscribeToken(options.token);
		const { emitter, emitOrBuffer, flush, stop } = createEventBuffer();
		let observability;
		let room;
		let frameMetadataWorker;
		let currentState = "connecting";
		let remoteStream = null;
		let inputStream = null;
		const setState = (state) => {
			if (currentState === state) return;
			currentState = state;
			options.onConnectionChange?.(state);
			emitOrBuffer("connectionChange", state);
		};
		const apiKey = await nextCredential();
		try {
			const liveKit = await loadLiveKitClient();
			const { Room: LiveKitRoom, RoomEvent } = liveKit;
			observability = new RealtimeObservability({
				telemetryEnabled: false,
				apiKey,
				integration,
				logger,
				onDiagnostic: (event) => emitOrBuffer("diagnostic", event)
			});
			setState("connecting");
			const creds = await fetchWatchStreamCredentials({
				baseUrl,
				apiKey,
				roomName
			});
			if (frameTiming) {
				if (!opts.createFrameMetadataWorker) throw createFrameMetadataSubscribeUnsupportedError("this platform has no frame-metadata worker");
				if (!(opts.isFrameMetadataRuntimeSupported?.() ?? false)) throw createFrameMetadataSubscribeUnsupportedError("encoded transforms are unavailable or the SDK is served cross-origin");
				try {
					frameMetadataWorker = opts.createFrameMetadataWorker();
				} catch (error) {
					throw createFrameMetadataSubscribeUnsupportedError(`failed to create the required worker (${error instanceof Error ? error.message : String(error)})`);
				}
			}
			try {
				room = new LiveKitRoom({
					...REALTIME_CONFIG.livekit.roomOptions,
					...frameMetadataWorker ? { frameMetadata: { worker: frameMetadataWorker } } : {}
				});
			} catch (error) {
				frameMetadataWorker?.terminate();
				frameMetadataWorker = void 0;
				throw error;
			}
			const activeRoom = room;
			const { onInputStream } = options;
			const inputVideoQuality = onInputStream ? {
				low: liveKit.VideoQuality.LOW,
				medium: liveKit.VideoQuality.MEDIUM,
				high: liveKit.VideoQuality.HIGH
			}[options.inputVideoQuality ?? "high"] : void 0;
			const isInferenceServer = (participant) => participant.identity.startsWith(REALTIME_CONFIG.livekit.inferenceServerIdentityPrefix);
			const subscribeIfWanted = (publication, participant) => {
				if (publication.kind !== "video" && publication.kind !== "audio") return;
				if (isInferenceServer(participant)) publication.setSubscribed(true);
				else if (onInputStream) {
					publication.setSubscribed(true);
					if (publication.kind === "video" && inputVideoQuality !== void 0) publication.setVideoQuality(inputVideoQuality);
				}
			};
			const subscribeExisting = () => {
				for (const participant of activeRoom.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) subscribeIfWanted(publication, participant);
			};
			activeRoom.on(RoomEvent.TrackPublished, subscribeIfWanted);
			activeRoom.on(RoomEvent.Reconnected, subscribeExisting);
			activeRoom.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
				if (track.kind !== "video" && track.kind !== "audio") return;
				const mediaStreamTrack = track.mediaStreamTrack;
				if (!mediaStreamTrack) return;
				if (isInferenceServer(participant)) {
					remoteStream = withTrack(remoteStream, mediaStreamTrack);
					options.onRemoteStream(remoteStream);
				} else if (onInputStream) {
					inputStream = withTrack(inputStream, mediaStreamTrack);
					onInputStream(inputStream);
				}
			});
			activeRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
				setState(mapLiveKitState(state));
			});
			activeRoom.on(RoomEvent.Disconnected, () => {
				setState("disconnected");
			});
			await activeRoom.connect(creds.livekit_url, creds.token, { autoSubscribe: false });
			subscribeExisting();
			observability.setLiveKitRoom(activeRoom);
			setState("connected");
			const client = {
				isConnected: () => activeRoom.state === "connected",
				getConnectionState: () => mapLiveKitState(activeRoom.state),
				disconnect: () => {
					observability?.stop();
					stop();
					activeRoom.disconnect().catch(() => {});
				},
				on: emitter.on,
				off: emitter.off
			};
			flush();
			return client;
		} catch (error) {
			observability?.stop();
			if (room) room.disconnect().catch(() => {});
			frameMetadataWorker?.terminate();
			if (isDecartSDKError(error)) {
				logger.error("Realtime subscribe error", { error: error.message });
				throw error;
			}
			const err = error instanceof Error ? error : new Error(String(error));
			logger.error("Realtime subscribe error", { error: err.message });
			throw classifyWebrtcError(err);
		}
	};
	return { subscribe };
};
//#endregion
export { createRealTimeSubscribeClient, decodeSubscribeToken };
