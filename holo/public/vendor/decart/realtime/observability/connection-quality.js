import { REALTIME_CONFIG } from "../config-realtime.js";
//#region src/realtime/observability/connection-quality.ts
const RANK = {
	critical: 0,
	poor: 1,
	fair: 2,
	good: 3
};
function worst(...qualities) {
	return qualities.reduce((a, b) => RANK[a] <= RANK[b] ? a : b);
}
function scoreLowerBetter(value, good, fair, poor) {
	if (value === null) return "good";
	if (value <= good) return "good";
	if (value <= fair) return "fair";
	if (value <= poor) return "poor";
	return "critical";
}
function scoreHigherBetter(value, good, fair, poor) {
	if (value === null) return "good";
	if (value >= good) return "good";
	if (value >= fair) return "fair";
	if (value >= poor) return "poor";
	return "critical";
}
function extractSignals(stats) {
	const rttSec = stats.remoteInbound?.roundTripTime ?? stats.connection.currentRoundTripTime;
	const isRelayed = stats.connection.selectedCandidatePairs.some((pair) => pair.local.candidateType === "relay" || pair.remote.candidateType === "relay");
	return {
		rttMs: rttSec != null ? rttSec * 1e3 : null,
		g2gMs: stats.glassToGlass?.medianMs ?? null,
		ttffMs: stats.glassToGlass?.ttffMs ?? null,
		upstreamJitterMs: stats.remoteInbound?.jitter != null ? stats.remoteInbound.jitter * 1e3 : null,
		fractionLost: stats.remoteInbound?.fractionLost != null ? stats.remoteInbound.fractionLost / 256 : null,
		g2gDropRatio: stats.glassToGlass?.dropRatio ?? null,
		availableOutgoingKbps: stats.connection.availableOutgoingBitrate != null ? stats.connection.availableOutgoingBitrate / 1e3 : null,
		fps: stats.video?.framesPerSecond ?? null,
		freezeCountDelta: stats.video?.freezeCountDelta ?? null,
		qualityLimitationReason: stats.outboundVideo?.qualityLimitationReason ?? null,
		isRelayed
	};
}
/** Score an already-extracted (optionally smoothed) signal set. Pure. */
function scoreMetrics(signals, thresholds, options = {}) {
	const relayExtra = signals.isRelayed ? thresholds.rtt.relayExtraMs : 0;
	const latency = signals.g2gMs != null ? scoreLowerBetter(signals.g2gMs, thresholds.glassToGlass.goodMs, thresholds.glassToGlass.fairMs, thresholds.glassToGlass.poorMs) : scoreLowerBetter(signals.rttMs, thresholds.rtt.goodMs + relayExtra, thresholds.rtt.fairMs + relayExtra, thresholds.rtt.poorMs + relayExtra);
	const loss = scoreLowerBetter(signals.fractionLost, thresholds.loss.good, thresholds.loss.fair, thresholds.loss.poor);
	let bandwidth = "good";
	if (!options.skipBitrate) {
		const { goodKbps, fairKbps, poorKbps } = thresholds.upstream;
		bandwidth = scoreHigherBetter(signals.availableOutgoingKbps, goodKbps, fairKbps, poorKbps);
		if (signals.qualityLimitationReason === "bandwidth") bandwidth = worst(bandwidth, "fair");
	}
	let stall = scoreHigherBetter(signals.fps, thresholds.stall.goodFps, thresholds.stall.fairFps, thresholds.stall.poorFps);
	if (signals.freezeCountDelta != null && signals.freezeCountDelta > 0) stall = worst(stall, "fair");
	const drop = scoreLowerBetter(signals.g2gDropRatio, thresholds.g2gDrop.good, thresholds.g2gDrop.fair, thresholds.g2gDrop.poor);
	stall = worst(stall, drop);
	const quality = worst(bandwidth, latency, loss, stall);
	let limitingFactor;
	if (quality === "good") limitingFactor = signals.qualityLimitationReason === "cpu" ? "cpu" : "none";
	else if (bandwidth === quality) limitingFactor = "bandwidth";
	else if (loss === quality) limitingFactor = "loss";
	else if (latency === quality) limitingFactor = "latency";
	else limitingFactor = "stall";
	return {
		quality,
		limitingFactor
	};
}
function median(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function minOrNull(values) {
	return values.length === 0 ? null : Math.min(...values);
}
var RingBuffer = class {
	size;
	values = [];
	constructor(size) {
		this.size = size;
	}
	push(value) {
		if (value === null) return;
		this.values.push(value);
		if (this.values.length > this.size) this.values.shift();
	}
	median() {
		return median(this.values);
	}
	min() {
		return minOrNull(this.values);
	}
	clear() {
		this.values = [];
	}
};
/**
* Smooths metrics over a rolling window and applies asymmetric hysteresis so the
* emitted level doesn't flap. `update()` returns a report only when the level or
* warm-up state changes; `current()` returns the latest at any time.
*/
var ConnectionQualityEvaluator = class {
	thresholds;
	rtt;
	glassToGlass;
	loss;
	availableOutgoing;
	fps;
	sampleCount = 0;
	currentLevel = null;
	currentFactor = "none";
	candidateLevel = null;
	candidateCount = 0;
	prevWarmingUp = true;
	lastReport = null;
	constructor(thresholds = REALTIME_CONFIG.observability.connectionQuality) {
		this.thresholds = thresholds;
		const w = thresholds.windowSamples;
		this.rtt = new RingBuffer(w);
		this.glassToGlass = new RingBuffer(w);
		this.loss = new RingBuffer(w);
		this.availableOutgoing = new RingBuffer(w);
		this.fps = new RingBuffer(w);
	}
	/** Feed one raw stats sample. Returns a report only when the level or warm-up state changes. */
	update(stats) {
		this.sampleCount++;
		const raw = extractSignals(stats);
		this.rtt.push(raw.rttMs);
		this.glassToGlass.push(raw.g2gMs);
		this.loss.push(raw.fractionLost);
		this.availableOutgoing.push(raw.availableOutgoingKbps);
		this.fps.push(raw.fps);
		const smoothed = {
			...raw,
			rttMs: this.rtt.median(),
			g2gMs: this.glassToGlass.median(),
			fractionLost: this.loss.median(),
			availableOutgoingKbps: this.availableOutgoing.median(),
			fps: this.fps.min()
		};
		const warmingUp = this.sampleCount < this.thresholds.warmupSamples;
		const { quality, limitingFactor } = scoreMetrics(smoothed, this.thresholds, { skipBitrate: warmingUp });
		const warmupJustEnded = this.prevWarmingUp && !warmingUp;
		this.prevWarmingUp = warmingUp;
		let changed;
		if (warmupJustEnded) {
			changed = this.currentLevel !== quality;
			this.currentLevel = quality;
			this.candidateLevel = null;
			this.candidateCount = 0;
		} else changed = this.applyHysteresis(quality);
		const emitted = this.currentLevel ?? quality;
		if (emitted === "good") this.currentFactor = smoothed.qualityLimitationReason === "cpu" ? "cpu" : "none";
		else if (RANK[quality] <= RANK[emitted]) this.currentFactor = limitingFactor;
		this.lastReport = {
			quality: emitted,
			limitingFactor: this.currentFactor,
			warmingUp,
			metrics: {
				rttMs: smoothed.rttMs,
				g2gMs: smoothed.g2gMs,
				ttffMs: raw.ttffMs,
				fps: smoothed.fps,
				packetLoss: smoothed.fractionLost,
				upstreamJitterMs: raw.upstreamJitterMs,
				g2gDropRatio: raw.g2gDropRatio,
				availableUpstreamKbps: smoothed.availableOutgoingKbps
			}
		};
		return changed || warmupJustEnded ? this.lastReport : null;
	}
	current() {
		return this.lastReport;
	}
	reset() {
		this.rtt.clear();
		this.glassToGlass.clear();
		this.loss.clear();
		this.availableOutgoing.clear();
		this.fps.clear();
		this.sampleCount = 0;
		this.currentLevel = null;
		this.currentFactor = "none";
		this.candidateLevel = null;
		this.candidateCount = 0;
		this.prevWarmingUp = true;
		this.lastReport = null;
	}
	/** Returns true if the debounced level changed this tick. */
	applyHysteresis(raw) {
		if (this.currentLevel === null) {
			this.currentLevel = raw;
			this.candidateLevel = null;
			this.candidateCount = 0;
			return true;
		}
		if (raw === this.currentLevel) {
			this.candidateLevel = null;
			this.candidateCount = 0;
			return false;
		}
		if (raw === this.candidateLevel) this.candidateCount++;
		else {
			this.candidateLevel = raw;
			this.candidateCount = 1;
		}
		const required = RANK[raw] < RANK[this.currentLevel] ? this.thresholds.downgradeConsecutive : this.thresholds.upgradeConsecutive;
		if (this.candidateCount >= required) {
			this.currentLevel = raw;
			this.candidateLevel = null;
			this.candidateCount = 0;
			return true;
		}
		return false;
	}
};
//#endregion
export { ConnectionQualityEvaluator, RANK, extractSignals, scoreLowerBetter, scoreMetrics, worst };
