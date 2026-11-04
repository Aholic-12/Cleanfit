//#region src/realtime/browser/frame-metadata-diagnostics.ts
const LATENCY_WINDOW = 300;
const MID_STREAM_WARMUP_MS = 2e3;
const MAX_PLAUSIBLE_MS = 6e4;
/**
* Collects glass-to-glass latency from LiveKit frame metadata. Both the
* publisher timestamp and the receiver synchronization-source timestamp are
* wall-clock values, so they can be compared without client/server clock sync.
*/
var FrameMetadataTracker = class {
	latencies = [];
	startMs = null;
	firstFrameMs = null;
	ttffMs = null;
	markStart(nowMs) {
		this.reset();
		this.startMs = nowMs;
	}
	recordFrame(userTimestampUs, playoutTimeMs) {
		if (userTimestampUs <= 0n) return;
		const latencyMs = playoutTimeMs - Number(userTimestampUs) / 1e3;
		if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > MAX_PLAUSIBLE_MS) return;
		if (this.firstFrameMs === null) {
			this.firstFrameMs = playoutTimeMs;
			if (this.startMs !== null) this.ttffMs = Math.round(playoutTimeMs - this.startMs);
		}
		if (playoutTimeMs < this.firstFrameMs + MID_STREAM_WARMUP_MS) return;
		this.latencies.push(latencyMs);
		if (this.latencies.length > LATENCY_WINDOW) this.latencies.shift();
	}
	snapshot() {
		const sorted = [...this.latencies].sort((a, b) => a - b);
		const n = sorted.length;
		const medianMs = n === 0 ? null : n % 2 === 0 ? Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2) : Math.round(sorted[(n - 1) / 2]);
		const p90Ms = n === 0 ? null : Math.round(sorted[Math.min(n - 1, Math.floor(.9 * n))]);
		return {
			ttffMs: this.ttffMs,
			medianMs,
			p90Ms,
			sampleCount: n,
			dropRatio: null
		};
	}
	reset() {
		this.latencies.length = 0;
		this.startMs = null;
		this.firstFrameMs = null;
		this.ttffMs = null;
	}
};
const TIME_SYNC_UPDATE = "timeSyncUpdate";
function createFrameReader(tracker) {
	let attachedTrack = null;
	const onTimeSyncUpdate = ({ timestamp, rtpTimestamp }) => {
		const frameMetadata = attachedTrack?.lookupFrameMetadata?.({ rtpTimestamp });
		if (frameMetadata) tracker.recordFrame(frameMetadata.userTimestamp, timestamp);
	};
	const detach = () => {
		attachedTrack?.off(TIME_SYNC_UPDATE, onTimeSyncUpdate);
		attachedTrack = null;
	};
	return {
		attach: (track) => {
			if (track === attachedTrack) return;
			detach();
			attachedTrack = track;
			track.on(TIME_SYNC_UPDATE, onTimeSyncUpdate);
		},
		detach,
		dispose: detach
	};
}
function createBrowserFrameMetadataDiagnostics() {
	const tracker = new FrameMetadataTracker();
	const reader = createFrameReader(tracker);
	return {
		attachRemoteVideoTrack: (track) => reader.attach(track),
		markStart: () => {
			reader.detach();
			tracker.markStart(performance.timeOrigin + performance.now());
		},
		snapshot: () => tracker.snapshot(),
		dispose: () => reader.dispose()
	};
}
const WORKER_URL = () => new URL("./frame-metadata-worker.js", import.meta.url);
function createFrameMetadataWorker() {
	return new Worker(WORKER_URL());
}
function isFrameMetadataWorkerSameOrigin(workerUrl, pageOrigin) {
	if (workerUrl.protocol !== "http:" && workerUrl.protocol !== "https:") return true;
	return workerUrl.origin === pageOrigin;
}
function isFrameMetadataRuntimeSupported() {
	if (typeof window === "undefined") return false;
	try {
		if (!isFrameMetadataWorkerSameOrigin(WORKER_URL(), window.location?.origin)) return false;
	} catch {
		return false;
	}
	const maybeWindow = window;
	const userAgent = window.navigator?.userAgent?.toLowerCase() ?? "";
	const isChromiumBased = /(?:chrome|chromium|crmo)\//.test(userAgent) && !/crios\//.test(userAgent);
	const scriptTransformSupported = typeof maybeWindow.RTCRtpScriptTransform !== "undefined" && !isChromiumBased;
	const insertableStreamsSupported = typeof maybeWindow.RTCRtpSender?.prototype?.createEncodedStreams !== "undefined" && typeof maybeWindow.RTCRtpReceiver?.prototype?.createEncodedStreams !== "undefined";
	return scriptTransformSupported || insertableStreamsSupported;
}
//#endregion
export { FrameMetadataTracker, createBrowserFrameMetadataDiagnostics, createFrameMetadataWorker, isFrameMetadataRuntimeSupported, isFrameMetadataWorkerSameOrigin };
