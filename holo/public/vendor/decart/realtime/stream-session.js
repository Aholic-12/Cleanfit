import { DecartSDKException, isDecartSDKError } from "../utils/errors.js";
import { REALTIME_CONFIG } from "./config-realtime.js";
import { createConsoleLogger } from "../utils/logger.js";
import { SignalingChannel } from "./signaling-channel.js";
import mitt from "mitt";
import pRetry, { AbortError } from "p-retry";
//#region src/realtime/stream-session.ts
function isTerminalEndReason(reason) {
	return reason !== void 0 && REALTIME_CONFIG.session.terminalEndReasons.includes(reason);
}
const POLICY_VIOLATION = "policy_violation";
const SESSION_LIMIT = "session_limit";
function isSessionLimitClose(code, reason) {
	const { closeCode, closeReason } = REALTIME_CONFIG.session.sessionLimit;
	return code === closeCode && typeof reason === "string" && reason.toLowerCase().includes(closeReason);
}
/**
* The 1008 reason is only sent once generation has started; earlier kills carry just
* the code. 1013 is terminal only with the session-limit reason: its other reason,
* "Try Again Later", is a transient capacity refusal.
*/
function terminalReasonFromClose(cause) {
	if (cause.code === REALTIME_CONFIG.session.terminalCloseCode) return POLICY_VIOLATION;
	if (isSessionLimitClose(cause.code, cause.reason)) return SESSION_LIMIT;
	return null;
}
/**
* SignalingChannel only emits `closed` after the handshake, so a close during the
* join reaches us as connect-failure text rather than an event. The session-limit
* refusal is preceded by an `error` message, which is usually what rejects the join;
* the 1013 close lands a tick later, so both texts are recognised.
*/
function terminalReasonFromError(error) {
	if (!(error instanceof Error)) return null;
	const message = error.message.toLowerCase();
	const { terminalCloseCode, sessionLimit } = REALTIME_CONFIG.session;
	if (message.includes(`websocket closed: ${terminalCloseCode}`)) return POLICY_VIOLATION;
	if (message.includes(`websocket closed: ${sessionLimit.closeCode} ${sessionLimit.closeReason}`)) return SESSION_LIMIT;
	if (message.includes(sessionLimit.errorText)) return SESSION_LIMIT;
	return null;
}
/**
* p-retry only accepts `Error` instances: a plain SDK error thrown inside a dial (an expired client
* token, an `apiKeyProvider` rejection) is carried across the retry loop as a `DecartSDKException`.
*/
function toDialError(thrown) {
	if (thrown instanceof Error) return thrown;
	if (isDecartSDKError(thrown)) return new DecartSDKException(thrown);
	return new Error(String(thrown));
}
/**
* The server's capacity refusal as the delay it asked for, in ms; `undefined` for any other
* failure, including a capacity error without a usable `retry_after` (which backs off as usual).
*/
function capacityRetryAfterMs(error) {
	if (!(error instanceof Error)) return void 0;
	const { errorType, retryAfter } = error;
	if (errorType !== REALTIME_CONFIG.session.capacity.errorType) return void 0;
	if (typeof retryAfter !== "number" || !Number.isFinite(retryAfter) || retryAfter < 0) return void 0;
	return retryAfter * 1e3;
}
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function encodeSubscribeToken(roomName, options = {}) {
	return btoa(JSON.stringify({
		room_name: roomName,
		...options.frameTiming ? { frame_timing: true } : {}
	}));
}
function getInitialImageSizeKb(image) {
	if (!image) return null;
	const commaIdx = image.indexOf(",");
	const base64 = commaIdx >= 0 && image.startsWith("data:") ? image.slice(commaIdx + 1) : image;
	const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
	const bytes = Math.floor(base64.length * 3 / 4) - padding;
	return Math.max(0, Math.round(bytes / 1024));
}
var StreamSession = class {
	config;
	signaling;
	media;
	events = mitt();
	state = "disconnected";
	queue = null;
	disposed = false;
	dialed = false;
	currentAttempt = 0;
	teardownGeneration = 0;
	terminalEndReason = null;
	/**
	* Replayed as a reconnect's initial state. Callers usually connect first and
	* send the image after, so without this the new session joins with nothing
	* applied and never starts generating.
	*/
	appliedState = null;
	logger;
	constructor(config) {
		this.config = config;
		this.logger = config.logger ?? createConsoleLogger("warn");
		this.createTransport();
	}
	on(event, handler) {
		this.events.on(event, handler);
	}
	off(event, handler) {
		this.events.off(event, handler);
	}
	getStatus() {
		return {
			connection: this.state,
			queue: this.queue
		};
	}
	getConnectionState() {
		return this.state;
	}
	isConnected() {
		return this.state === "connected" || this.state === "generating";
	}
	async connect() {
		this.disposed = false;
		this.terminalEndReason = null;
		const attempt = ++this.currentAttempt;
		this.setState("connecting");
		this.logger.info("realtime connect: starting", { attemptCycle: attempt });
		try {
			const startedAt = Date.now();
			for (let wait = 1;; wait++) try {
				return await pRetry(() => this.runOneConnect(attempt), this.retryOptionsFor(attempt, this.config.connectRetries, true));
			} catch (error) {
				const delayMs = this.capacityWaitMs(attempt, error, startedAt);
				if (delayMs === void 0) throw error;
				const capacityWait = {
					retryAfterMs: delayMs,
					attempt: wait
				};
				this.logger.warn("realtime connect: server at capacity; waiting before re-dial", capacityWait);
				this.events.emit("capacityWait", capacityWait);
				await sleep(delayMs);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const terminal = this.terminalEndReason ?? terminalReasonFromError(error);
			if (terminal) {
				if (!this.disposed) this.finishTerminally(terminal, {
					source: "connect",
					error: message
				});
				throw error;
			}
			this.logger.error("realtime connect: exhausted all retries", { error: message });
			if (this.currentAttempt === attempt && !this.disposed) this.setState("disconnected");
			throw error;
		}
	}
	async sendPrompt(text, opts) {
		this.assertConnected();
		await this.signaling.sendPrompt(text, opts);
		this.appliedState = {
			...this.getInitialState(),
			prompt: text,
			enhance: opts?.enhance
		};
	}
	async setImage(payload, opts) {
		this.assertConnected();
		await this.signaling.setImage(payload, opts);
		this.appliedState = payload.kind === "ref" ? {
			imageRef: payload.ref,
			prompt: opts?.prompt ?? null,
			enhance: opts?.enhance
		} : {
			image: payload.data,
			prompt: opts?.prompt ?? null,
			enhance: opts?.enhance
		};
	}
	async replaceVideoTrack(track) {
		this.assertConnected();
		await this.media.replaceVideoTrack(track);
		const previous = this.config.localStream;
		this.config.localStream = new MediaStream(previous ? [track, ...previous.getAudioTracks()] : [track]);
	}
	disconnect() {
		this.disposed = true;
		this.tearDown();
		this.setState("disconnected");
	}
	assertConnected() {
		if (!this.isConnected()) throw new Error(`Cannot send message: connection is ${this.state}`);
	}
	/**
	* The jittered wait before `connect()` dials again after a capacity refusal, or `undefined` when
	* that refusal ends the connect: re-dials are off, the session is gone, or the wait would end past
	* `capacityRetryBudgetMs`. Floored at `minWaitMs` so a tiny `retry_after` cannot re-dial into the
	* refused socket's own close.
	*/
	capacityWaitMs(attempt, error, startedAt) {
		const retryAfterMs = capacityRetryAfterMs(error);
		if (retryAfterMs === void 0 || this.config.connectRetries === 0) return void 0;
		if (this.disposed || this.currentAttempt !== attempt) return void 0;
		const { jitter, minWaitMs } = REALTIME_CONFIG.session.capacity;
		const budgetMs = this.config.capacityRetryBudgetMs ?? REALTIME_CONFIG.session.capacity.budgetMs;
		const delayMs = Math.max(minWaitMs, Math.round(retryAfterMs * (1 - jitter + Math.random() * 2 * jitter)));
		const elapsedMs = Date.now() - startedAt;
		if (elapsedMs + delayMs > budgetMs) {
			this.logger.error("realtime connect: server at capacity, retry budget used up", {
				elapsedMs,
				delayMs,
				budgetMs
			});
			return;
		}
		return delayMs;
	}
	retryOptionsFor(attempt, retries = REALTIME_CONFIG.session.retry.retries, capacityWaits = false) {
		return {
			...REALTIME_CONFIG.session.retry,
			retries,
			onFailedAttempt: (_error) => {
				this.tearDown();
			},
			shouldRetry: (error) => {
				if (this.disposed || this.currentAttempt !== attempt) return false;
				if (capacityWaits && capacityRetryAfterMs(error) !== void 0) return false;
				const terminal = this.terminalEndReason ?? terminalReasonFromError(error);
				if (terminal) {
					this.terminalEndReason = terminal;
					this.logger.error("realtime connect: session refused, not retrying", { reason: terminal });
					return false;
				}
				const sdkCode = error instanceof DecartSDKException ? error.sdkError.code : void 0;
				if (sdkCode && REALTIME_CONFIG.session.permanentErrorCodes.includes(sdkCode)) {
					this.logger.error("realtime connect: credential refused, not retrying", {
						code: sdkCode,
						error: error.message
					});
					return false;
				}
				const msg = error.message.toLowerCase();
				const permanent = REALTIME_CONFIG.session.permanentErrorSubstrings.some((err) => msg.includes(err));
				if (permanent) this.logger.error("realtime connect: permanent error, not retrying", { error: error.message });
				return !permanent;
			}
		};
	}
	async runOneConnect(attempt) {
		if (this.disposed || this.currentAttempt !== attempt) throw new AbortError("Stale connect attempt");
		try {
			this.resetHandshakeState();
			const initialState = this.getInitialState();
			this.config.observability?.beginConnectionBreakdown(attempt, getInitialImageSizeKb(initialState?.image));
			this.config.observability?.markGlassToGlassStart();
			const { roomInfo, initialStateAck } = await this.signaling.openAndJoin({
				connectTimeout: REALTIME_CONFIG.session.connectionTimeoutMs,
				initialState,
				passthrough: this.config.initialPassthrough,
				frameTiming: this.config.frameTiming
			});
			this.watchInitialStateAck(initialStateAck, attempt);
			if (this.disposed || this.currentAttempt !== attempt) {
				this.tearDown();
				throw new AbortError("Stale connect attempt");
			}
			this.queue = null;
			try {
				await this.media.connect({
					url: roomInfo.livekitUrl,
					token: roomInfo.token
				});
				await this.media.publishLocalTracks();
			} catch (error) {
				this.tearDown();
				throw error;
			}
			if (this.disposed || this.currentAttempt !== attempt) {
				this.tearDown();
				throw new AbortError("Stale connect attempt");
			}
			this.config.observability?.finishConnectionBreakdown({ success: true });
			this.setState("connected");
			this.events.emit("sessionStarted", {
				sessionId: roomInfo.sessionId,
				subscribeToken: encodeSubscribeToken(roomInfo.roomName, { frameTiming: this.config.frameTiming })
			});
		} catch (thrown) {
			const error = toDialError(thrown);
			this.config.observability?.finishConnectionBreakdown({
				success: false,
				error: error.message
			});
			throw error;
		}
	}
	watchInitialStateAck(initialStateAck, attempt) {
		const generation = this.teardownGeneration;
		initialStateAck.catch((error) => {
			if (this.disposed || this.currentAttempt !== attempt || this.teardownGeneration !== generation) return;
			this.events.emit("error", error instanceof Error ? error : new Error(String(error)));
		});
	}
	getInitialState() {
		return this.appliedState ?? this.configInitialState();
	}
	configInitialState() {
		if (this.config.initialImageRef !== void 0) return {
			imageRef: this.config.initialImageRef,
			prompt: this.config.initialPrompt?.text,
			enhance: this.config.initialPrompt?.enhance
		};
		if (this.config.initialImage !== void 0) return {
			image: this.config.initialImage,
			prompt: this.config.initialPrompt?.text,
			enhance: this.config.initialPrompt?.enhance
		};
		if (this.config.initialPrompt) return {
			prompt: this.config.initialPrompt.text,
			enhance: this.config.initialPrompt.enhance
		};
	}
	wireSignalingEvents() {
		this.signaling.on("queuePosition", (qp) => {
			this.queue = qp;
			this.events.emit("queuePosition", qp);
		});
		this.signaling.on("generationStarted", () => this.markGenerating());
		this.signaling.on("generationTick", (e) => {
			this.markGenerating();
			this.events.emit("generationTick", e);
		});
		this.signaling.on("generationEnded", (e) => {
			if (isTerminalEndReason(e.reason)) this.terminalEndReason = e.reason;
			this.events.emit("generationEnded", e);
		});
		this.signaling.on("serverError", (err) => this.events.emit("error", err));
		this.signaling.on("closed", (info) => {
			this.terminalEndReason ??= terminalReasonFromClose({ ...info });
			this.handleConnectionLoss({
				source: "signaling",
				...info
			});
		});
	}
	markGenerating() {
		if (this.state === "connected") this.setState("generating");
	}
	wireMediaEvents() {
		this.media.on("remoteStream", (stream) => this.events.emit("remoteStream", stream));
		this.media.on("disconnected", (info) => this.handleConnectionLoss({
			source: "media",
			reason: info.reason
		}));
	}
	handleConnectionLoss(cause) {
		if (this.disposed) return;
		const terminalReason = this.terminalEndReason ?? terminalReasonFromClose(cause);
		if (terminalReason) {
			this.finishTerminally(terminalReason, cause);
			return;
		}
		if (this.state !== "connected" && this.state !== "generating") {
			this.logger.debug("connection loss ignored (not connected)", {
				state: this.state,
				...cause
			});
			return;
		}
		this.logger.warn("realtime connection lost; scheduling reconnect", {
			state: this.state,
			...cause
		});
		this.scheduleReconnect();
	}
	/**
	* The server ended this session on purpose: retrying would get the same answer
	* and bill another session, and "reconnecting" would hide the reason.
	*/
	finishTerminally(reason, cause) {
		this.logger.warn("realtime session ended by the server; not reconnecting", {
			...cause,
			reason,
			state: this.state
		});
		this.terminalEndReason = reason;
		this.disposed = true;
		this.tearDown();
		this.setState("disconnected");
		this.events.emit("sessionEnded", { reason });
	}
	scheduleReconnect() {
		const attempt = ++this.currentAttempt;
		this.setState("reconnecting");
		pRetry(async () => {
			if (this.disposed || this.currentAttempt !== attempt) throw new AbortError("Reconnect cancelled");
			this.tearDown();
			this.createTransport();
			await this.runOneConnect(attempt);
		}, this.retryOptionsFor(attempt)).then(() => {
			if (this.disposed || this.currentAttempt !== attempt) return;
			this.logger.info("realtime reconnect: succeeded");
		}).catch((error) => {
			if (this.disposed || this.currentAttempt !== attempt) return;
			const message = error instanceof Error ? error.message : String(error);
			const terminal = this.terminalEndReason ?? terminalReasonFromError(error);
			if (terminal) {
				this.finishTerminally(terminal, {
					source: "reconnect",
					error: message
				});
				return;
			}
			this.logger.error("realtime reconnect: failed permanently", { error: message });
			this.tearDown();
			this.setState("disconnected");
			this.events.emit("error", error instanceof Error ? error : new Error(String(error)));
		});
	}
	/** The first dial uses the connect-time URL; every later one asks `redialUrl`. */
	resolveDialUrl() {
		const redial = this.dialed ? this.config.redialUrl : void 0;
		this.dialed = true;
		if (!redial) return this.config.url;
		const url = redial();
		if (typeof url === "string") return url;
		const attempt = this.currentAttempt;
		return url.then((resolved) => {
			if (this.disposed || this.currentAttempt !== attempt) throw new AbortError("Stale connect attempt");
			return resolved;
		});
	}
	createTransport() {
		this.signaling = new SignalingChannel({
			url: () => this.resolveDialUrl(),
			integration: this.config.integration,
			logger: this.logger,
			observability: this.config.observability
		});
		this.media = this.config.createMediaChannel({
			observability: this.config.observability,
			localStream: this.config.localStream,
			logger: this.logger,
			videoCodec: this.config.videoCodec
		});
		this.wireSignalingEvents();
		this.wireMediaEvents();
	}
	tearDown() {
		this.teardownGeneration++;
		this.signaling.close();
		this.media.disconnect();
		this.resetHandshakeState();
	}
	resetHandshakeState() {
		this.queue = null;
	}
	setState(state) {
		if (this.state === state) return;
		this.logger.debug("realtime state change", {
			from: this.state,
			to: state
		});
		this.state = state;
		this.events.emit("connectionChange", state);
	}
};
//#endregion
export { StreamSession, encodeSubscribeToken };
