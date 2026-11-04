import { VERSION } from "../../version.js";
import { buildAuthHeaders } from "../../shared/request.js";
import { REALTIME_CONFIG } from "../config-realtime.js";
//#region src/realtime/observability/telemetry-reporter.ts
const KEEPALIVE_MAX_BODY_BYTES = 60 * 1024;
/** No-op reporter that silently discards all data. Used when telemetry is disabled. */
var NullTelemetryReporter = class {
	start() {}
	addStats() {}
	addDiagnostic() {}
	flush() {}
	stop() {}
};
var TelemetryReporter = class {
	apiKey;
	sessionId;
	model;
	integration;
	reportIntervalMs;
	intervalId = null;
	statsBuffer = [];
	diagnosticsBuffer = [];
	constructor(options) {
		this.apiKey = options.apiKey;
		this.sessionId = options.sessionId;
		this.model = options.model;
		this.integration = options.integration;
		this.reportIntervalMs = options.reportIntervalMs ?? REALTIME_CONFIG.observability.telemetryReportIntervalMs;
	}
	/** Start the periodic reporting timer. */
	start() {
		if (this.intervalId !== null) return;
		this.intervalId = setInterval(() => this.flush(), this.reportIntervalMs);
	}
	/** Add a stats snapshot to the buffer. */
	addStats(stats) {
		this.statsBuffer.push(stats);
	}
	/** Add a diagnostic event to the buffer. */
	addDiagnostic(event) {
		this.diagnosticsBuffer.push(event);
	}
	/** Flush buffered data immediately. */
	flush() {
		this.sendReport();
	}
	/** Stop the reporter and make one final best-effort flush. */
	stop() {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.sendReport({ keepalive: true });
	}
	/**
	* Build a single chunk from the front of the buffers, respecting the configured report item cap.
	* Returns null when both buffers are empty.
	*/
	createReportChunk() {
		if (this.statsBuffer.length === 0 && this.diagnosticsBuffer.length === 0) return null;
		const tags = {
			session_id: this.sessionId,
			sdk_version: VERSION,
			...this.model ? { model: this.model } : {},
			...this.integration ? { integration: this.integration } : {}
		};
		return {
			sessionId: this.sessionId,
			timestamp: Date.now(),
			sdkVersion: VERSION,
			...this.model ? { model: this.model } : {},
			tags,
			stats: this.statsBuffer.splice(0, REALTIME_CONFIG.observability.telemetryMaxItemsPerReport),
			diagnostics: this.diagnosticsBuffer.splice(0, REALTIME_CONFIG.observability.telemetryMaxItemsPerReport)
		};
	}
	sendReport(options = {}) {
		if (this.statsBuffer.length === 0 && this.diagnosticsBuffer.length === 0) return;
		try {
			const commonHeaders = {
				...buildAuthHeaders({
					apiKey: this.apiKey,
					integration: this.integration
				}),
				"Content-Type": "application/json"
			};
			const chunks = [];
			let nextChunk = this.createReportChunk();
			while (nextChunk !== null) {
				chunks.push(nextChunk);
				nextChunk = this.createReportChunk();
			}
			chunks.forEach((chunk, index) => {
				const body = JSON.stringify(chunk);
				const useKeepalive = options.keepalive && index === chunks.length - 1 && new TextEncoder().encode(body).byteLength <= KEEPALIVE_MAX_BODY_BYTES;
				fetch(REALTIME_CONFIG.observability.telemetryUrl, {
					method: "POST",
					headers: commonHeaders,
					body,
					...useKeepalive ? { keepalive: true } : {}
				}).catch(() => {});
			});
		} catch {}
	}
};
//#endregion
export { NullTelemetryReporter, TelemetryReporter };
