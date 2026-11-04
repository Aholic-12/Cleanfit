import { REALTIME_CONFIG } from "../config-realtime.js";
import { ConnectionQualityEvaluator } from "./connection-quality.js";
import { createLiveKitStatsProvider } from "./livekit-stats-provider.js";
import { NullTelemetryReporter, TelemetryReporter } from "./telemetry-reporter.js";
import { WebRTCStatsCollector } from "./webrtc-stats.js";
//#region src/realtime/observability/realtime-observability.ts
var RealtimeObservability = class {
	options;
	telemetryReporter = new NullTelemetryReporter();
	telemetryReporterReady = false;
	pendingTelemetryDiagnostics = [];
	statsCollector = null;
	statsCollectorSource = null;
	liveKitRoom = null;
	videoStalled = false;
	stallStartMs = 0;
	connectionBreakdown = null;
	connectionQuality = new ConnectionQualityEvaluator();
	glassToGlass;
	constructor(options) {
		this.options = options;
		this.glassToGlass = options.glassToGlass;
	}
	/** Feed the LiveKit remote video track to the frame-metadata reader. */
	attachRemoteVideoTrack(track) {
		this.glassToGlass?.attachRemoteVideoTrack(track);
	}
	/**
	* Mark the start of a connect attempt for glass-to-glass timing (resets the
	* tracker and starts the TTFF clock). Called at the top of each connect/
	* reconnect so TTFF measures the full setup→first-frame wait. No-op unless g2g
	* measurement is on.
	*/
	markGlassToGlassStart() {
		this.glassToGlass?.markStart();
	}
	diagnostic(name, data, timestamp = Date.now()) {
		this.options.logger.debug(name, data);
		this.options.onDiagnostic?.({
			name,
			data
		});
		this.addTelemetryDiagnostic(name, data, timestamp);
	}
	beginConnectionBreakdown(attempt, initialImageSizeKb) {
		this.connectionBreakdown = {
			attempt,
			connectStartedAt: Date.now(),
			initialImageSizeKb,
			phases: /* @__PURE__ */ new Map()
		};
	}
	startPhase(name) {
		if (!this.connectionBreakdown) return;
		this.connectionBreakdown.phases.set(name, { startedAt: Date.now() });
	}
	endPhase(name, opts) {
		if (!this.connectionBreakdown) return;
		const entry = this.connectionBreakdown.phases.get(name);
		if (!entry) {
			this.options.logger.warn("observability: endPhase called for unknown phase", { phase: name });
			return;
		}
		entry.endedAt = Date.now();
		entry.success = opts.success;
		if (opts.error !== void 0) entry.error = opts.error;
	}
	finishConnectionBreakdown(opts) {
		const buffer = this.connectionBreakdown;
		if (!buffer) return;
		this.connectionBreakdown = null;
		const now = Date.now();
		const phases = [];
		for (const [phase, entry] of buffer.phases) {
			const unfinished = entry.endedAt === void 0;
			const endedAt = entry.endedAt ?? now;
			const success = entry.success ?? false;
			const error = entry.error ?? (unfinished && !opts.success ? opts.error : void 0);
			phases.push({
				phase,
				durationMs: endedAt - entry.startedAt,
				success,
				...error !== void 0 ? { error } : {}
			});
		}
		this.diagnostic("client-session-connection-breakdown", {
			attempt: buffer.attempt,
			success: opts.success,
			totalDurationMs: now - buffer.connectStartedAt,
			initialImageSizeKb: buffer.initialImageSizeKb,
			phases,
			...opts.error !== void 0 ? { error: opts.error } : {}
		}, now);
	}
	/** `apiKey` is the credential the session dialled with; a reconnect may carry a fresher one than connect did. */
	sessionStarted(sessionId, apiKey = this.options.apiKey) {
		if (!this.options.telemetryEnabled) return;
		if (this.telemetryReporterReady) this.telemetryReporter.stop();
		const reporter = new TelemetryReporter({
			apiKey,
			sessionId,
			model: this.options.model,
			integration: this.options.integration,
			logger: this.options.logger
		});
		reporter.start();
		this.telemetryReporter = reporter;
		this.telemetryReporterReady = true;
		for (const diagnostic of this.pendingTelemetryDiagnostics) this.telemetryReporter.addDiagnostic(diagnostic);
		this.pendingTelemetryDiagnostics.length = 0;
	}
	setStatsProvider(source) {
		if (!source) {
			this.stopStats();
			return;
		}
		if (source === this.statsCollectorSource) return;
		this.stopStats();
		this.resetStallDetection();
		this.statsCollectorSource = source;
		if (!this.options.telemetryEnabled && !this.options.onStats && !this.options.onConnectionQuality) return;
		this.statsCollector = new WebRTCStatsCollector();
		this.statsCollector.start(source, (stats) => this.handleStats(stats));
	}
	setLiveKitRoom(room) {
		if (!room) {
			this.liveKitRoom = null;
			this.setStatsProvider(null);
			return;
		}
		if (room === this.liveKitRoom) return;
		this.setStatsProvider(createLiveKitStatsProvider(room));
		this.liveKitRoom = room;
	}
	stopStats() {
		this.statsCollector?.stop();
		this.statsCollector = null;
		this.statsCollectorSource = null;
		this.liveKitRoom = null;
		this.resetStallDetection();
	}
	stop() {
		this.stopStats();
		this.glassToGlass?.dispose();
		this.telemetryReporter.stop();
		this.telemetryReporter = new NullTelemetryReporter();
		this.telemetryReporterReady = false;
		this.pendingTelemetryDiagnostics.length = 0;
		this.connectionBreakdown = null;
	}
	getConnectionQuality() {
		return this.connectionQuality.current();
	}
	handleStats(stats) {
		if (this.glassToGlass) stats.glassToGlass = this.glassToGlass.snapshot();
		this.options.onStats?.(stats);
		this.telemetryReporter.addStats(stats);
		this.detectVideoStall(stats);
		const report = this.connectionQuality.update(stats);
		if (report) this.options.onConnectionQuality?.(report);
	}
	detectVideoStall(stats) {
		const fps = stats.video?.framesPerSecond ?? 0;
		if (!this.videoStalled && stats.video && fps < REALTIME_CONFIG.observability.stallFpsThreshold) {
			this.videoStalled = true;
			this.stallStartMs = Date.now();
			this.diagnostic("videoStall", {
				stalled: true,
				durationMs: 0
			}, this.stallStartMs);
		} else if (this.videoStalled && fps >= REALTIME_CONFIG.observability.stallFpsThreshold) {
			const durationMs = Date.now() - this.stallStartMs;
			this.videoStalled = false;
			this.diagnostic("videoStall", {
				stalled: false,
				durationMs
			});
		}
	}
	addTelemetryDiagnostic(name, data, timestamp) {
		if (!this.options.telemetryEnabled) return;
		const diagnostic = {
			name,
			data,
			timestamp
		};
		if (!this.telemetryReporterReady) {
			this.pendingTelemetryDiagnostics.push(diagnostic);
			return;
		}
		this.telemetryReporter.addDiagnostic(diagnostic);
	}
	resetStallDetection() {
		this.videoStalled = false;
		this.stallStartMs = 0;
		this.connectionQuality.reset();
	}
};
//#endregion
export { RealtimeObservability };
