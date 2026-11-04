import { REALTIME_CONFIG } from "../config-realtime.js";
//#region src/realtime/observability/webrtc-stats.ts
var WebRTCStatsCollector = class {
	source = null;
	intervalId = null;
	prevBytesVideo = 0;
	prevBytesAudio = 0;
	prevBytesSentVideo = 0;
	prevTimestamp = 0;
	prevPacketsLostVideo = 0;
	prevFramesDropped = 0;
	prevFreezeCount = 0;
	prevFreezeDuration = 0;
	prevPacketsLostAudio = 0;
	prevNackCountInbound = 0;
	onStats = null;
	intervalMs;
	constructor(options = {}) {
		this.intervalMs = Math.max(options.intervalMs ?? REALTIME_CONFIG.observability.statsDefaultIntervalMs, REALTIME_CONFIG.observability.statsMinIntervalMs);
	}
	/** Attach to a stats provider and start polling. */
	start(source, onStats) {
		this.stop();
		this.source = source;
		this.onStats = onStats;
		this.prevBytesVideo = 0;
		this.prevBytesAudio = 0;
		this.prevBytesSentVideo = 0;
		this.prevTimestamp = 0;
		this.prevPacketsLostVideo = 0;
		this.prevFramesDropped = 0;
		this.prevFreezeCount = 0;
		this.prevFreezeDuration = 0;
		this.prevPacketsLostAudio = 0;
		this.prevNackCountInbound = 0;
		this.intervalId = setInterval(() => this.collect(), this.intervalMs);
	}
	/** Stop polling and release resources. */
	stop() {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.source = null;
		this.onStats = null;
	}
	isRunning() {
		return this.intervalId !== null;
	}
	async collect() {
		if (!this.source || !this.onStats) return;
		try {
			const rawStats = await this.source.getStats();
			const stats = this.parse(rawStats);
			this.onStats(stats);
		} catch {
			this.stop();
		}
	}
	parse(rawStats) {
		const now = performance.now();
		const elapsed = this.prevTimestamp > 0 ? (now - this.prevTimestamp) / 1e3 : 0;
		let video = null;
		let audio = null;
		let outboundVideo = null;
		let remoteInbound = null;
		const connection = {
			currentRoundTripTime: null,
			availableOutgoingBitrate: null,
			selectedCandidatePairs: []
		};
		const succeededPairs = [];
		rawStats.forEach((report) => {
			if (report.type === "inbound-rtp" && report.kind === "video") {
				const bytesReceived = report.bytesReceived ?? 0;
				const bitrate = elapsed > 0 ? (bytesReceived - this.prevBytesVideo) * 8 / elapsed : 0;
				this.prevBytesVideo = bytesReceived;
				const r = report;
				const packetsLost = r.packetsLost ?? 0;
				const framesDropped = r.framesDropped ?? 0;
				const freezeCount = r.freezeCount ?? 0;
				const freezeDuration = r.totalFreezesDuration ?? 0;
				const framesDecoded = r.framesDecoded ?? 0;
				const nackCount = r.nackCount ?? 0;
				const jbEmitted = r.jitterBufferEmittedCount ?? 0;
				const totalDecodeTime = r.totalDecodeTime ?? 0;
				const totalProcessingDelay = r.totalProcessingDelay ?? 0;
				const totalInterFrameDelay = r.totalInterFrameDelay ?? 0;
				const totalSquaredInterFrameDelay = r.totalSquaredInterFrameDelay ?? 0;
				const jitterBufferDelay = r.jitterBufferDelay ?? 0;
				const jitterBufferTargetDelay = r.jitterBufferTargetDelay ?? 0;
				const jitterBufferMinimumDelay = r.jitterBufferMinimumDelay ?? 0;
				const avgDecodeTimeMs = framesDecoded > 0 ? totalDecodeTime / framesDecoded * 1e3 : null;
				const avgProcessingDelayMs = framesDecoded > 0 ? totalProcessingDelay / framesDecoded * 1e3 : null;
				const avgInterFrameDelayMs = framesDecoded > 0 ? totalInterFrameDelay / framesDecoded * 1e3 : null;
				const interFrameDelayStdDevMs = framesDecoded > 0 ? Math.sqrt(Math.max(0, totalSquaredInterFrameDelay / framesDecoded - (totalInterFrameDelay / framesDecoded) ** 2)) * 1e3 : null;
				const avgJitterBufferMs = jbEmitted > 0 ? jitterBufferDelay / jbEmitted * 1e3 : null;
				const jitterBufferTargetDelayMs = jbEmitted > 0 ? jitterBufferTargetDelay / jbEmitted * 1e3 : null;
				const jitterBufferMinimumDelayMs = jbEmitted > 0 ? jitterBufferMinimumDelay / jbEmitted * 1e3 : null;
				video = {
					framesDecoded,
					framesDropped,
					framesReceived: r.framesReceived ?? 0,
					keyFramesDecoded: r.keyFramesDecoded ?? 0,
					framesPerSecond: r.framesPerSecond ?? 0,
					frameWidth: r.frameWidth ?? 0,
					frameHeight: r.frameHeight ?? 0,
					bytesReceived,
					packetsReceived: r.packetsReceived ?? 0,
					packetsLost,
					jitter: r.jitter ?? 0,
					bitrate: Math.round(bitrate),
					freezeCount,
					totalFreezesDuration: freezeDuration,
					packetsLostDelta: Math.max(0, packetsLost - this.prevPacketsLostVideo),
					framesDroppedDelta: Math.max(0, framesDropped - this.prevFramesDropped),
					freezeCountDelta: Math.max(0, freezeCount - this.prevFreezeCount),
					freezeDurationDelta: Math.max(0, freezeDuration - this.prevFreezeDuration),
					nackCount,
					nackCountDelta: Math.max(0, nackCount - this.prevNackCountInbound),
					pliCount: r.pliCount ?? 0,
					firCount: r.firCount ?? 0,
					avgDecodeTimeMs,
					avgJitterBufferMs,
					avgProcessingDelayMs,
					avgInterFrameDelayMs,
					interFrameDelayStdDevMs,
					jitterBufferTargetDelayMs,
					jitterBufferMinimumDelayMs,
					decoderImplementation: r.decoderImplementation ?? ""
				};
				this.prevPacketsLostVideo = packetsLost;
				this.prevFramesDropped = framesDropped;
				this.prevFreezeCount = freezeCount;
				this.prevFreezeDuration = freezeDuration;
				this.prevNackCountInbound = nackCount;
			}
			if (report.type === "outbound-rtp" && report.kind === "video") {
				const r = report;
				const bytesSent = r.bytesSent ?? 0;
				const packetsSent = r.packetsSent ?? 0;
				const frameWidth = r.frameWidth ?? 0;
				const frameHeight = r.frameHeight ?? 0;
				const pixels = frameWidth * frameHeight;
				const framesEncoded = r.framesEncoded ?? 0;
				const totalEncodeTime = r.totalEncodeTime ?? 0;
				const totalPacketSendDelay = r.totalPacketSendDelay ?? 0;
				const qpSum = r.qpSum ?? 0;
				const nackCount = r.nackCount ?? 0;
				const pliCount = r.pliCount ?? 0;
				const firCount = r.firCount ?? 0;
				const retransmittedBytesSent = r.retransmittedBytesSent ?? 0;
				const retransmittedPacketsSent = r.retransmittedPacketsSent ?? 0;
				const targetBitrate = r.targetBitrate ?? null;
				const avgEncodeTimeMs = framesEncoded > 0 ? totalEncodeTime / framesEncoded * 1e3 : null;
				const avgPacketSendDelayMs = packetsSent > 0 ? totalPacketSendDelay / packetsSent * 1e3 : null;
				const avgQp = framesEncoded > 0 ? qpSum / framesEncoded : null;
				if (outboundVideo === null) outboundVideo = {
					qualityLimitationReason: r.qualityLimitationReason ?? "none",
					qualityLimitationDurations: r.qualityLimitationDurations ?? {},
					bytesSent,
					packetsSent,
					framesPerSecond: r.framesPerSecond ?? 0,
					frameWidth,
					frameHeight,
					bitrate: 0,
					targetBitrateKbps: targetBitrate != null ? Math.round(targetBitrate / 1e3) : null,
					avgEncodeTimeMs,
					avgPacketSendDelayMs,
					avgQp,
					nackCount,
					pliCount,
					firCount,
					retransmittedBytesSent,
					retransmittedPacketsSent,
					encoderImplementation: r.encoderImplementation ?? ""
				};
				else {
					outboundVideo.bytesSent += bytesSent;
					outboundVideo.packetsSent += packetsSent;
					outboundVideo.nackCount += nackCount;
					outboundVideo.pliCount += pliCount;
					outboundVideo.firCount += firCount;
					outboundVideo.retransmittedBytesSent += retransmittedBytesSent;
					outboundVideo.retransmittedPacketsSent += retransmittedPacketsSent;
					if (pixels > outboundVideo.frameWidth * outboundVideo.frameHeight) {
						outboundVideo.frameWidth = frameWidth;
						outboundVideo.frameHeight = frameHeight;
						outboundVideo.framesPerSecond = r.framesPerSecond ?? 0;
						outboundVideo.qualityLimitationReason = r.qualityLimitationReason ?? "none";
						outboundVideo.qualityLimitationDurations = r.qualityLimitationDurations ?? {};
						outboundVideo.targetBitrateKbps = targetBitrate != null ? Math.round(targetBitrate / 1e3) : null;
						outboundVideo.avgEncodeTimeMs = avgEncodeTimeMs;
						outboundVideo.avgPacketSendDelayMs = avgPacketSendDelayMs;
						outboundVideo.avgQp = avgQp;
						outboundVideo.encoderImplementation = r.encoderImplementation ?? "";
					}
				}
			}
			if (report.type === "remote-inbound-rtp" && report.kind === "video") {
				const r = report;
				remoteInbound = {
					fractionLost: r.fractionLost ?? null,
					jitter: r.jitter ?? null,
					roundTripTime: r.roundTripTime ?? null
				};
			}
			if (report.type === "inbound-rtp" && report.kind === "audio") {
				const bytesReceived = report.bytesReceived ?? 0;
				const bitrate = elapsed > 0 ? (bytesReceived - this.prevBytesAudio) * 8 / elapsed : 0;
				this.prevBytesAudio = bytesReceived;
				const r = report;
				const audioPacketsLost = r.packetsLost ?? 0;
				audio = {
					bytesReceived,
					packetsReceived: r.packetsReceived ?? 0,
					packetsLost: audioPacketsLost,
					jitter: r.jitter ?? 0,
					bitrate: Math.round(bitrate),
					packetsLostDelta: Math.max(0, audioPacketsLost - this.prevPacketsLostAudio)
				};
				this.prevPacketsLostAudio = audioPacketsLost;
			}
			if (report.type === "candidate-pair") {
				const r = report;
				if (r.state === "succeeded") {
					connection.currentRoundTripTime = r.currentRoundTripTime ?? null;
					connection.availableOutgoingBitrate = r.availableOutgoingBitrate ?? null;
					const localId = r.localCandidateId;
					const remoteId = r.remoteCandidateId;
					if (localId && remoteId) succeededPairs.push({
						localId,
						remoteId
					});
				}
			}
		});
		if (succeededPairs.length > 0) {
			const toInfo = (id) => {
				const c = rawStats.get(id);
				if (!c) return null;
				return {
					candidateType: c.candidateType ?? "",
					address: c.address ?? c.ip ?? "",
					port: c.port ?? 0,
					protocol: c.protocol ?? ""
				};
			};
			for (const { localId, remoteId } of succeededPairs) {
				const local = toInfo(localId);
				const remote = toInfo(remoteId);
				if (local && remote) connection.selectedCandidatePairs.push({
					local,
					remote
				});
			}
		}
		const ov = outboundVideo;
		if (ov !== null) {
			const outBitrate = elapsed > 0 ? (ov.bytesSent - this.prevBytesSentVideo) * 8 / elapsed : 0;
			ov.bitrate = Math.max(0, Math.round(outBitrate));
			this.prevBytesSentVideo = ov.bytesSent;
		}
		this.prevTimestamp = now;
		return {
			timestamp: Date.now(),
			video,
			audio,
			outboundVideo,
			connection,
			remoteInbound,
			glassToGlass: null
		};
	}
};
//#endregion
export { WebRTCStatsCollector };
