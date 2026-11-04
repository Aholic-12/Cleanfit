import { buildUserAgent } from "../utils/user-agent.js";
import { REALTIME_CONFIG } from "./config-realtime.js";
import { createConsoleLogger } from "../utils/logger.js";
import mitt from "mitt";
//#region src/realtime/signaling-channel.ts
function buildInitialStateRequest(initialState) {
	if (!initialState) return null;
	if (initialState.imageRef !== void 0 || initialState.image !== void 0) {
		const message = initialState.imageRef !== void 0 ? {
			type: "set_image",
			image_ref: initialState.imageRef
		} : {
			type: "set_image",
			image_data: initialState.image ?? null
		};
		if (initialState.prompt !== void 0) message.prompt = initialState.prompt;
		if (initialState.enhance !== void 0) message.enhance_prompt = initialState.enhance;
		return {
			message,
			matchAck: (msg) => msg.type === "set_image_ack",
			label: "Image send"
		};
	}
	if (initialState.prompt !== void 0 && initialState.prompt !== null) {
		const text = initialState.prompt;
		return {
			message: {
				type: "prompt",
				prompt: text,
				enhance_prompt: initialState.enhance ?? true
			},
			matchAck: (msg) => msg.type === "prompt_ack" && msg.prompt === text,
			label: "Prompt send"
		};
	}
	return null;
}
var SignalingChannel = class {
	config;
	ws = null;
	events = mitt();
	pendingAcks = [];
	bufferedAcks = [];
	pendingRoomInfo = null;
	connected = false;
	closing = false;
	logger;
	constructor(config) {
		this.config = config;
		this.logger = config.logger ?? createConsoleLogger("warn");
	}
	on(event, handler) {
		this.events.on(event, handler);
	}
	off(event, handler) {
		this.events.off(event, handler);
	}
	async openAndJoin(opts = {}) {
		const connectTimeout = opts.connectTimeout ?? REALTIME_CONFIG.signaling.connectTimeoutMs;
		const handshakeTimeout = opts.handshakeTimeout ?? REALTIME_CONFIG.signaling.handshakeTimeoutMs;
		const dial = typeof this.config.url === "function" ? this.config.url() : this.config.url;
		const url = typeof dial === "string" ? dial : await dial;
		this.config.observability?.startPhase("websocket-open");
		await this.openSocket(url, connectTimeout);
		this.config.observability?.endPhase("websocket-open", { success: true });
		this.config.observability?.startPhase("room-join");
		const roomInfoWait = this.waitForRoomInfo(handshakeTimeout);
		const initialStateRequest = buildInitialStateRequest(opts.initialState);
		const userSetInitialState = opts.initialState != null && (opts.initialState.image != null || opts.initialState.imageRef != null || opts.initialState.prompt != null);
		const joinMessage = {
			type: "livekit_join",
			passthrough: opts.passthrough ?? !userSetInitialState,
			...opts.frameTiming ? { client_capabilities: { frame_timing: true } } : {}
		};
		if (!this.writeMessage(joinMessage)) {
			roomInfoWait.cancel();
			throw new Error("WebSocket is not open");
		}
		if (initialStateRequest && !this.writeMessage(initialStateRequest.message)) {
			roomInfoWait.cancel();
			throw new Error("WebSocket is not open");
		}
		let roomInfo;
		try {
			roomInfo = await roomInfoWait.promise;
		} catch (error) {
			this.rejectAllPending(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
		this.config.observability?.endPhase("room-join", { success: true });
		this.connected = true;
		const initialStateAck = initialStateRequest ? this.flushInitialState(initialStateRequest) : Promise.resolve();
		initialStateAck.catch(() => {});
		return {
			roomInfo,
			initialStateAck
		};
	}
	async flushInitialState(request) {
		this.config.observability?.startPhase("initial-state-handshake");
		const ack = await this.request({
			message: request.message,
			matchAck: request.matchAck,
			timeoutMs: REALTIME_CONFIG.signaling.requestTimeoutMs,
			label: request.label,
			write: false
		});
		this.config.observability?.endPhase("initial-state-handshake", { success: true });
		if (!ack.success) throw new Error(ack.error ?? `Failed: ${request.label}`);
	}
	close() {
		this.closing = true;
		this.connected = false;
		const ws = this.ws;
		this.ws = null;
		if (ws) try {
			ws.close();
		} catch {}
		this.rejectPendingRoomInfo(/* @__PURE__ */ new Error("Control channel closed"));
		this.rejectAllPending(/* @__PURE__ */ new Error("Control channel closed"));
	}
	async sendPrompt(text, opts = {}) {
		const ack = await this.request({
			message: {
				type: "prompt",
				prompt: text,
				enhance_prompt: opts.enhance ?? true
			},
			matchAck: (msg) => msg.type === "prompt_ack" && msg.prompt === text,
			timeoutMs: opts.timeout ?? REALTIME_CONFIG.signaling.requestTimeoutMs,
			label: "Prompt send"
		});
		if (!ack.success) throw new Error(ack.error ?? "Failed to send prompt");
	}
	async setImage(payload, opts = {}) {
		const message = payload.kind === "ref" ? {
			type: "set_image",
			image_ref: payload.ref
		} : {
			type: "set_image",
			image_data: payload.data
		};
		if (opts.prompt !== void 0) message.prompt = opts.prompt;
		if (opts.enhance !== void 0) message.enhance_prompt = opts.enhance;
		const ack = await this.request({
			message,
			matchAck: (msg) => msg.type === "set_image_ack",
			timeoutMs: opts.timeout ?? REALTIME_CONFIG.signaling.requestTimeoutMs,
			label: "Image send"
		});
		if (!ack.success) throw new Error(ack.error ?? "Failed to send image");
	}
	async openSocket(url, timeout) {
		const userAgent = encodeURIComponent(buildUserAgent(this.config.integration));
		const wsUrl = `${url}${url.includes("?") ? "&" : "?"}user_agent=${userAgent}`;
		this.closing = false;
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(/* @__PURE__ */ new Error(`WebSocket open timeout (${timeout}ms)`)), timeout);
			const ws = new WebSocket(wsUrl);
			this.ws = ws;
			ws.onopen = () => {
				clearTimeout(timer);
				resolve();
			};
			ws.onclose = (e) => {
				clearTimeout(timer);
				const wasConnected = this.connected;
				const pendingCount = this.pendingAcks.length;
				this.connected = false;
				this.ws = null;
				this.logger.warn("signaling: websocket closed", {
					code: e.code,
					reason: e.reason,
					wasConnected,
					closing: this.closing,
					pendingAcks: pendingCount
				});
				const error = /* @__PURE__ */ new Error(`WebSocket closed: ${e.code} ${e.reason}`);
				this.rejectPendingRoomInfo(error);
				this.rejectAllPending(error);
				if (wasConnected || this.closing) this.events.emit("closed", {
					code: e.code,
					reason: e.reason
				});
				else reject(error);
			};
			ws.onerror = () => {};
			ws.onmessage = (e) => {
				try {
					this.handleMessage(JSON.parse(e.data));
				} catch {}
			};
		});
	}
	waitForRoomInfo(timeoutMs) {
		let cleanup = () => {};
		return {
			promise: new Promise((resolve, reject) => {
				let timer = setTimeout(() => {
					cleanup();
					this.logger.warn("signaling: livekit_room_info timeout", { timeoutMs });
					reject(/* @__PURE__ */ new Error(`livekit_room_info timeout (${timeoutMs}ms)`));
				}, timeoutMs);
				const pendingRoomInfo = {
					resolve: (info) => {
						cleanup();
						resolve(info);
					},
					reject: (err) => {
						cleanup();
						reject(err);
					},
					cancel: () => {
						cleanup();
					},
					pauseTimeout: () => {
						if (timer) {
							clearTimeout(timer);
							timer = null;
						}
					}
				};
				cleanup = () => {
					if (timer) {
						clearTimeout(timer);
						timer = null;
					}
					if (this.pendingRoomInfo === pendingRoomInfo) this.pendingRoomInfo = null;
				};
				this.pendingRoomInfo = pendingRoomInfo;
			}),
			cancel: cleanup
		};
	}
	async request({ message, matchAck, timeoutMs, label, write = true }) {
		return new Promise((resolve, reject) => {
			const buffered = this.bufferedAcks.findIndex((m) => matchAck(m));
			if (buffered !== -1) {
				const [claimed] = this.bufferedAcks.splice(buffered, 1);
				resolve(claimed);
				return;
			}
			const timer = setTimeout(() => {
				cleanup();
				this.logger.warn("signaling: ack timed out", {
					label,
					timeoutMs
				});
				reject(/* @__PURE__ */ new Error(`${label} timed out`));
			}, timeoutMs);
			const entry = {
				matches: matchAck,
				onMatch: (msg) => {
					cleanup();
					resolve(msg);
				},
				reject: (err) => {
					cleanup();
					reject(err);
				}
			};
			const cleanup = () => {
				clearTimeout(timer);
				this.pendingAcks = this.pendingAcks.filter((e) => e !== entry);
			};
			this.pendingAcks.push(entry);
			if (write && !this.writeMessage(message)) {
				cleanup();
				reject(/* @__PURE__ */ new Error("WebSocket is not open"));
			}
		});
	}
	writeMessage(message) {
		if (this.ws?.readyState !== WebSocket.OPEN) return false;
		this.ws.send(JSON.stringify(message));
		return true;
	}
	handleMessage(msg) {
		for (const ack of [...this.pendingAcks]) if (ack.matches(msg)) {
			ack.onMatch(msg);
			return;
		}
		if (!this.connected && (msg.type === "set_image_ack" || msg.type === "prompt_ack")) {
			this.bufferedAcks.push(msg);
			return;
		}
		switch (msg.type) {
			case "livekit_room_info":
				this.resolvePendingRoomInfo({
					livekitUrl: msg.livekit_url,
					token: msg.token,
					roomName: msg.room_name,
					sessionId: msg.session_id
				});
				break;
			case "queue_position":
				this.pendingRoomInfo?.pauseTimeout();
				this.events.emit("queuePosition", {
					position: msg.position,
					queueSize: msg.queue_size
				});
				break;
			case "generation_started":
				this.events.emit("generationStarted");
				break;
			case "generation_tick":
				this.events.emit("generationTick", { seconds: msg.seconds });
				break;
			case "generation_ended":
				this.events.emit("generationEnded", {
					seconds: msg.seconds,
					reason: msg.reason
				});
				break;
			case "error": {
				const error = new Error(msg.error);
				error.source = "server";
				if (typeof msg.error_type === "string") error.errorType = msg.error_type;
				if (typeof msg.retry_after === "number") error.retryAfter = msg.retry_after;
				this.logger.error("signaling: server error received", { error: msg.error });
				this.events.emit("serverError", error);
				this.rejectPendingRoomInfo(error);
				this.rejectAllPending(error);
				break;
			}
		}
	}
	resolvePendingRoomInfo(info) {
		const pending = this.pendingRoomInfo;
		if (!pending) return;
		pending.resolve(info);
	}
	rejectPendingRoomInfo(error) {
		const pending = this.pendingRoomInfo;
		if (!pending) return;
		pending.reject(error);
	}
	rejectAllPending(error) {
		const pending = this.pendingAcks;
		this.pendingAcks = [];
		this.bufferedAcks = [];
		for (const entry of pending) entry.reject(error);
	}
};
//#endregion
export { SignalingChannel };
