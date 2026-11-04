//#region src/realtime/preflight-connectivity.ts
function candidateType(candidate) {
	if (candidate.type) return candidate.type;
	return /\btyp (\w+)/.exec(candidate.candidate)?.[1] ?? "";
}
function nowMs() {
	return globalThis.performance?.now?.() ?? Date.now();
}
async function gatherIceCandidates(iceServers, timeoutMs, signal, logger) {
	if (signal?.aborted) return {
		transport: "failed",
		rttMs: null
	};
	const PC = globalThis?.RTCPeerConnection;
	if (typeof PC !== "function") {
		logger.warn("preflight: RTCPeerConnection unavailable in this environment");
		return {
			transport: "failed",
			rttMs: null
		};
	}
	let pc = null;
	try {
		pc = new PC({ iceServers });
		pc.createDataChannel("decart-preflight");
		let sawSrflx = false;
		let sawOtherCandidate = false;
		let firstSrflxAt = null;
		const start = nowMs();
		await new Promise((resolve) => {
			let settled = false;
			let timer;
			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", finish);
				resolve();
			};
			timer = setTimeout(finish, timeoutMs);
			signal?.addEventListener("abort", finish, { once: true });
			if (signal?.aborted) finish();
			const peer = pc;
			peer.onicecandidate = (event) => {
				if (!event.candidate || event.candidate.candidate === "") return finish();
				if (candidateType(event.candidate) === "srflx") {
					sawSrflx = true;
					if (firstSrflxAt === null) firstSrflxAt = nowMs();
				} else sawOtherCandidate = true;
			};
			peer.onicegatheringstatechange = () => {
				if (peer.iceGatheringState === "complete") finish();
			};
			peer.createOffer().then((offer) => peer.setLocalDescription(offer)).catch((error) => {
				logger.warn("preflight: failed to create offer", { error: error instanceof Error ? error.message : String(error) });
				finish();
			});
		});
		const rttMs = firstSrflxAt !== null ? Math.round(firstSrflxAt - start) : null;
		return {
			transport: sawSrflx ? "udp" : sawOtherCandidate ? "relay" : "failed",
			rttMs
		};
	} catch (error) {
		logger.warn("preflight: connectivity probe threw", { error: error instanceof Error ? error.message : String(error) });
		return {
			transport: "failed",
			rttMs: null
		};
	} finally {
		try {
			pc?.close();
		} catch {}
	}
}
function classifyConnectivity(metrics, thresholds) {
	const reasons = [];
	let quality;
	if (metrics.transport === "failed") {
		quality = "critical";
		reasons.push("Could not establish any WebRTC connectivity (no ICE candidates gathered). Real-time streaming is unlikely to work on this network.");
	} else if (metrics.transport === "relay") {
		quality = "poor";
		reasons.push("Direct UDP connectivity could not be confirmed; the session will need a TURN relay, which adds latency and can't be verified without starting a session.");
	} else if (metrics.rttMs != null && metrics.rttMs > thresholds.marginalMs) {
		quality = "poor";
		reasons.push(`Network round-trip time is high (~${metrics.rttMs}ms > ${thresholds.marginalMs}ms); the real-time experience may feel laggy.`);
	} else if (metrics.rttMs != null && metrics.rttMs > thresholds.goodMs) {
		quality = "fair";
		reasons.push(`Network round-trip time is elevated (~${metrics.rttMs}ms > ${thresholds.goodMs}ms).`);
	} else quality = "good";
	return {
		quality,
		metrics: {
			transport: metrics.transport,
			rttMs: metrics.rttMs
		},
		reasons
	};
}
//#endregion
export { classifyConnectivity, gatherIceCandidates };
