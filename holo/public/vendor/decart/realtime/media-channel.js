import { REALTIME_CONFIG } from "./config-realtime.js";
import { createConsoleLogger } from "../utils/logger.js";
import { loadLiveKitClient } from "./livekit.js";
import mitt from "mitt";
//#region src/realtime/media-channel.ts
const START_BITRATE_PARAM = "x-google-start-bitrate";
/** Add `x-google-start-bitrate=<kbps>` to every video codec's fmtp line; libwebrtc reads it from the remote description. */
function withVideoStartBitrate(sdp, kbps) {
	const param = `${START_BITRATE_PARAM}=${kbps}`;
	return sdp.split(/(?=^m=)/m).map((section) => {
		if (!section.startsWith("m=video")) return section;
		const withFmtp = new Set(Array.from(section.matchAll(/^a=fmtp:(\d+) /gm), (m) => m[1]));
		return section.replace(/^a=fmtp:\d+ [^\r\n]*/gm, (line) => line.includes(START_BITRATE_PARAM) ? line : `${line};${param}`).replace(/^a=rtpmap:(\d+) (?!rtx|red|ulpfec|flexfec)[^\r\n]*(\r?\n)/gim, (line, pt, eol) => withFmtp.has(pt) ? line : `${line}a=fmtp:${pt} ${param}${eol}`);
	}).join("");
}
function usesSimulcast(videoCodec) {
	return (videoCodec ?? REALTIME_CONFIG.livekit.defaultVideoCodec) !== "vp9";
}
/** Bandwidth-estimator seed (kbps) for the publisher. */
function getVideoStartBitrateKbps(videoCodec) {
	const { minVideoBitrateBps, simulcastLowerLayersBitrateBps, bweVideoShare } = REALTIME_CONFIG.livekit;
	const lowerLayers = usesSimulcast(videoCodec) ? simulcastLowerLayersBitrateBps : 0;
	return Math.round((minVideoBitrateBps + lowerLayers) / bweVideoShare / 1e3);
}
function getDefaultVideoPublishOptions(source, videoCodec, frameMetadata = false) {
	const resolvedCodec = videoCodec ?? REALTIME_CONFIG.livekit.defaultVideoCodec;
	const maxBitrate = resolvedCodec === "vp9" ? REALTIME_CONFIG.livekit.vp9MaxVideoBitrateBps : REALTIME_CONFIG.livekit.defaultMaxVideoBitrateBps;
	return {
		source,
		videoCodec: resolvedCodec,
		simulcast: usesSimulcast(resolvedCodec),
		videoEncoding: {
			maxBitrate,
			maxFramerate: REALTIME_CONFIG.livekit.defaultPublishFps
		},
		...frameMetadata ? { frameMetadata: { timestamp: true } } : {}
	};
}
var LiveKitMediaChannel = class {
	config;
	room = null;
	cameraTrackSource = null;
	remoteStream = null;
	frameMetadataEnabled = false;
	events = mitt();
	logger;
	constructor(config) {
		this.config = config;
		this.logger = config.logger ?? createConsoleLogger("warn");
	}
	get localStream() {
		return this.config.localStream;
	}
	on(event, handler) {
		this.events.on(event, handler);
	}
	off(event, handler) {
		this.events.off(event, handler);
	}
	async connect(opts) {
		const { Room: LiveKitRoom, RoomEvent, Track } = await loadLiveKitClient();
		this.cameraTrackSource = Track.Source.Camera;
		if (!this.room) {
			let worker;
			if (this.config.createFrameMetadataWorker) try {
				worker = this.config.createFrameMetadataWorker();
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				this.logger.warn("Failed to create LiveKit frame-metadata worker", { error: detail });
				throw new Error(`Failed to create LiveKit frame-metadata worker: ${detail}`, { cause: error });
			}
			this.frameMetadataEnabled = worker !== void 0;
			try {
				this.room = new LiveKitRoom({
					...REALTIME_CONFIG.livekit.roomOptions,
					...worker ? { frameMetadata: { worker } } : {}
				});
			} catch (error) {
				worker?.terminate();
				this.frameMetadataEnabled = false;
				throw error;
			}
		}
		const room = this.room;
		const remoteAudio = this.wantsRemoteAudio();
		const isInferenceServer = (participant) => participant.identity.startsWith(REALTIME_CONFIG.livekit.inferenceServerIdentityPrefix);
		const subscribeIfWanted = (publication, participant) => {
			if (!isInferenceServer(participant)) return;
			if (publication.kind === "video" || publication.kind === "audio" && remoteAudio) publication.setSubscribed(true);
		};
		const subscribeExisting = () => {
			for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) subscribeIfWanted(publication, participant);
		};
		room.on(RoomEvent.TrackPublished, subscribeIfWanted);
		room.on(RoomEvent.Reconnected, subscribeExisting);
		room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
			if (!isInferenceServer(participant)) return;
			if (track.kind !== "video" && !(track.kind === "audio" && remoteAudio)) return;
			const mediaStreamTrack = track.mediaStreamTrack;
			if (mediaStreamTrack) {
				if (track.kind === "video") this.config.observability?.attachRemoteVideoTrack(track);
				const tracks = this.remoteStream?.getTracks() ?? [];
				if (!tracks.includes(mediaStreamTrack)) tracks.push(mediaStreamTrack);
				this.remoteStream = new MediaStream(tracks);
				this.events.emit("remoteStream", this.remoteStream);
			}
		});
		room.on(RoomEvent.Disconnected, (reason) => {
			this.logger.warn("livekit: room disconnected", { reason });
			this.events.emit("disconnected", { reason });
		});
		this.config.observability?.startPhase("webrtc-handshake");
		await room.connect(opts.url, opts.token, { autoSubscribe: false });
		this.config.observability?.endPhase("webrtc-handshake", { success: true });
		subscribeExisting();
		this.seedStartBitrate(room);
		this.config.observability?.setLiveKitRoom(room);
	}
	async publishLocalTracks() {
		if (!this.config.localStream) return;
		this.config.observability?.startPhase("publish-local-track");
		await this.publishTracks(this.config.localStream);
		this.config.observability?.endPhase("publish-local-track", { success: true });
	}
	async replaceVideoTrack(track) {
		const room = this.room;
		if (!room) throw new Error("Cannot replace video track: media channel is not connected");
		const videoTrack = [...room.localParticipant.videoTrackPublications.values()][0]?.videoTrack;
		if (!videoTrack) throw new Error("Cannot replace video track: no published video track");
		await videoTrack.replaceTrack(track);
	}
	disconnect() {
		const room = this.room;
		this.room = null;
		this.cameraTrackSource = null;
		this.remoteStream = null;
		this.frameMetadataEnabled = false;
		this.config.observability?.setLiveKitRoom(null);
		if (room) room.disconnect().catch(() => {});
	}
	/**
	* The server's audio track is our own audio played back, delayed to stay in
	* sync with the transformed video, so subscribe to it exactly when we publish
	* audio. A video-only client has nothing to hear, and merely playing out a
	* remote audio track starts the device's audio engine (on iOS that alone shows
	* the microphone permission prompt).
	*/
	wantsRemoteAudio() {
		return (this.config.localStream?.getAudioTracks().length ?? 0) > 0;
	}
	/**
	* livekit-client has no start-bitrate option for H264/VP8, so seed the estimator through the
	* SFU answer. Installed once per room: if livekit-client itself performs a full reconnect it
	* creates a new publisher transport, and the rest of that session ramps from the default.
	*/
	seedStartBitrate(room) {
		const publisher = room.engine?.pcManager?.publisher;
		const original = publisher?.setRemoteDescription;
		if (!publisher || typeof original !== "function") return;
		const kbps = getVideoStartBitrateKbps(this.config.videoCodec);
		publisher.setRemoteDescription = (sd, offerId) => original.call(publisher, sd.type === "answer" && sd.sdp ? {
			type: sd.type,
			sdp: withVideoStartBitrate(sd.sdp, kbps)
		} : sd, offerId);
	}
	async publishTracks(stream) {
		if (!this.room) return;
		for (const track of stream.getTracks()) if (track.kind === "video") {
			if (!this.cameraTrackSource) throw new Error("Cannot publish video track: media channel is not connected");
			await this.room.localParticipant.publishTrack(track, getDefaultVideoPublishOptions(this.cameraTrackSource, this.config.videoCodec, this.frameMetadataEnabled));
		} else await this.room.localParticipant.publishTrack(track);
	}
};
const createLiveKitMediaChannel = (config) => new LiveKitMediaChannel(config);
//#endregion
export { LiveKitMediaChannel, createLiveKitMediaChannel, getDefaultVideoPublishOptions, getVideoStartBitrateKbps, withVideoStartBitrate };
