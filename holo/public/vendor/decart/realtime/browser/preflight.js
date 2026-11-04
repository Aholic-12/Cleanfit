import { REALTIME_CONFIG } from "../config-realtime.js";
import { resolveFpsNumber } from "../../shared/model.js";
import { extractSignals, scoreLowerBetter, worst } from "../observability/connection-quality.js";
import { classifyConnectivity, gatherIceCandidates } from "../preflight-connectivity.js";
//#region src/realtime/browser/preflight.ts
/**
* Classify an active-probe result. Judges startup (TTFF) and steady-state
* (mid-stream glass-to-glass) latency separately — both are real experienced
* latency on different scales — and folds in drops + upstream loss. Falls back
* to RTT only when neither latency could be measured. Pure.
*/
function classifyActiveProbe(metrics, thresholds) {
	const reasons = [];
	if (metrics.transport === "failed") return {
		quality: "critical",
		metrics,
		reasons: ["Could not establish a realtime session for the deep probe."]
	};
	const dims = [];
	if (metrics.ttffMs != null) {
		const t = thresholds.ttff;
		const q = scoreLowerBetter(metrics.ttffMs, t.goodMs, t.fairMs, t.poorMs);
		dims.push(q);
		if (q !== "good") reasons.push(`Time to first frame is ~${(metrics.ttffMs / 1e3).toFixed(1)}s (good ≤ ${(t.goodMs / 1e3).toFixed(0)}s); the session is slow to start.`);
	}
	if (metrics.g2gMs != null) {
		const g = thresholds.glassToGlass;
		const q = scoreLowerBetter(metrics.g2gMs, g.goodMs, g.fairMs, g.poorMs);
		dims.push(q);
		if (q !== "good") reasons.push(`Mid-stream glass-to-glass latency is ~${metrics.g2gMs}ms (good ≤ ${g.goodMs}ms); the real-time experience may feel laggy.`);
	}
	if (metrics.ttffMs == null && metrics.g2gMs == null) if (metrics.rttMs != null) {
		reasons.push("Could not measure glass-to-glass latency during the probe (no frame metadata); using network RTT instead.");
		dims.push(scoreLowerBetter(metrics.rttMs, thresholds.rtt.goodMs, thresholds.rtt.fairMs, thresholds.rtt.poorMs));
	} else reasons.push("The probe connected but could not measure latency (no frame metadata and no RTT sample).");
	if (metrics.g2gDropRatio != null) {
		const d = thresholds.g2gDrop;
		const q = scoreLowerBetter(metrics.g2gDropRatio, d.good, d.fair, d.poor);
		dims.push(q);
		if (q !== "good") reasons.push(`End-to-end frame drop ratio is ${(metrics.g2gDropRatio * 100).toFixed(1)}% (good ≤ ${d.good * 100}%).`);
	}
	if (metrics.packetLoss != null) {
		const l = thresholds.loss;
		const q = scoreLowerBetter(metrics.packetLoss, l.good, l.fair, l.poor);
		dims.push(q);
		if (q !== "good") reasons.push(`Upstream packet loss is ${(metrics.packetLoss * 100).toFixed(1)}% (good ≤ ${l.good * 100}%).`);
	}
	if (dims.length === 0) return {
		quality: "fair",
		metrics,
		reasons
	};
	return {
		quality: worst(...dims),
		metrics,
		reasons
	};
}
/** Derive active-probe metrics from the latest in-session stats sample. */
function activeMetricsFromStats(stats) {
	if (!stats) return {
		transport: "udp",
		rttMs: null,
		g2gMs: null,
		ttffMs: null,
		g2gDropRatio: null,
		upstreamJitterMs: null,
		packetLoss: null,
		sampleCount: 0
	};
	const s = extractSignals(stats);
	return {
		transport: s.isRelayed ? "relay" : "udp",
		rttMs: s.rttMs != null ? Math.round(s.rttMs) : null,
		g2gMs: s.g2gMs,
		ttffMs: s.ttffMs,
		g2gDropRatio: s.g2gDropRatio,
		upstreamJitterMs: s.upstreamJitterMs != null ? Math.round(s.upstreamJitterMs) : null,
		packetLoss: s.fractionLost,
		sampleCount: stats.glassToGlass?.sampleCount ?? 0
	};
}
/**
* Animated synthetic video source — no camera permission needed. It uses the
* model's input dimensions to exercise the same encode/inference path as a real
* session without unnecessary server-side resizing.
*/
function createSyntheticSource(width, height, fps) {
	if (typeof document === "undefined") throw new Error("deep connectivity probe requires a DOM environment (document is undefined)");
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("deep connectivity probe: 2D canvas context unavailable");
	if (typeof canvas.captureStream !== "function") throw new Error("deep connectivity probe: canvas.captureStream unavailable");
	let rafHandle = null;
	let frame = 0;
	const draw = () => {
		frame++;
		ctx.fillStyle = `hsl(${frame % 360}, 60%, 50%)`;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = "white";
		ctx.fillRect(frame * 7 % canvas.width, 48, 96, 96);
		rafHandle = requestAnimationFrame(draw);
	};
	rafHandle = requestAnimationFrame(draw);
	const stream = canvas.captureStream(fps);
	return {
		stream,
		dispose: () => {
			if (rafHandle !== null) cancelAnimationFrame(rafHandle);
			for (const track of stream.getTracks()) track.stop();
		}
	};
}
const ABORTED_DEEP_PROBE = {
	quality: "fair",
	metrics: {
		transport: "failed",
		rttMs: null,
		g2gMs: null,
		ttffMs: null,
		g2gDropRatio: null,
		upstreamJitterMs: null,
		packetLoss: null,
		sampleCount: 0
	},
	reasons: ["Deep connectivity probe aborted."]
};
/** Unblock `promise` early when `signal` aborts. */
function raceAbort(promise, signal) {
	if (!signal) return promise;
	if (signal.aborted) throw signal.reason ?? createAbortError();
	return Promise.race([promise, new Promise((_, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason ?? createAbortError()), { once: true });
	})]);
}
function createAbortError() {
	const DOMExceptionConstructor = globalThis.DOMException;
	if (typeof DOMExceptionConstructor === "function") return new DOMExceptionConstructor("Aborted", "AbortError");
	const error = /* @__PURE__ */ new Error("Aborted");
	error.name = "AbortError";
	return error;
}
/** Resolve once enough g2g samples exist or the probe window elapses (never rejects). */
function waitForProbe(getLatest, minSamples, durationMs, signal) {
	return new Promise((resolve) => {
		const start = performance.now();
		const tick = () => {
			if (signal?.aborted) return resolve();
			if ((getLatest()?.glassToGlass?.sampleCount ?? 0) >= minSamples) return resolve();
			if (performance.now() - start >= durationMs) return resolve();
			setTimeout(tick, 200);
		};
		setTimeout(tick, 200);
	});
}
async function runActiveProbe(args) {
	const { connect, logger, model, durationMs, signal } = args;
	const thresholds = REALTIME_CONFIG.observability.connectionQuality;
	let source;
	let client;
	let latest = null;
	if (signal?.aborted) return ABORTED_DEEP_PROBE;
	try {
		source = createSyntheticSource(model.width, model.height, resolveFpsNumber(model.fps));
		const connectTask = connect(source.stream, {
			model,
			onRemoteStream: () => {}
		});
		signal?.addEventListener("abort", () => connectTask.then((c) => c.disconnect()).catch(() => {}), { once: true });
		client = await raceAbort(connectTask, signal);
		client.on("stats", (stats) => {
			latest = stats;
		});
		await waitForProbe(() => latest, REALTIME_CONFIG.preflight.active.minSamples, durationMs, signal);
		if (signal?.aborted) return ABORTED_DEEP_PROBE;
	} catch (error) {
		if (signal?.aborted) return ABORTED_DEEP_PROBE;
		logger.warn("deep connectivity probe failed", { error: error instanceof Error ? error.message : String(error) });
		return classifyActiveProbe({
			transport: "failed",
			rttMs: null,
			g2gMs: null,
			g2gDropRatio: null,
			upstreamJitterMs: null,
			packetLoss: null,
			sampleCount: 0
		}, thresholds);
	} finally {
		client?.disconnect();
		source?.dispose();
	}
	return classifyActiveProbe(activeMetricsFromStats(latest), thresholds);
}
const DEFAULT_ICE_SERVERS = REALTIME_CONFIG.preflight.defaultStunUrls.map((urls) => ({ urls }));
const createPreflight = ({ logger, connect }) => {
	const checkConnectivity = async (options = {}) => {
		if (options.deep) {
			if (!connect) throw new Error("deep connectivity probe is unavailable (realtime client not wired)");
			if (!options.model) throw new Error("deep connectivity probe requires a `model` (latency is model-specific)");
			return runActiveProbe({
				connect,
				logger,
				model: options.model,
				durationMs: options.durationMs ?? REALTIME_CONFIG.preflight.active.durationMs,
				signal: options.signal
			});
		}
		return classifyConnectivity(await gatherIceCandidates(options.iceServers ?? DEFAULT_ICE_SERVERS, options.iceGatherTimeoutMs ?? REALTIME_CONFIG.preflight.iceGatherTimeoutMs, options.signal, logger), REALTIME_CONFIG.preflight.rtt);
	};
	return { checkConnectivity };
};
//#endregion
export { classifyActiveProbe, createPreflight };
