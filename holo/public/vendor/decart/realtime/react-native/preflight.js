import { REALTIME_CONFIG } from "../config-realtime.js";
import { classifyConnectivity, gatherIceCandidates } from "../preflight-connectivity.js";
//#region src/realtime/react-native/preflight.ts
function createReactNativePreflight({ logger }) {
	return { checkConnectivity: async (options = {}) => {
		return classifyConnectivity(await gatherIceCandidates(options.iceServers ?? REALTIME_CONFIG.preflight.defaultStunUrls.map((urls) => ({ urls })), options.iceGatherTimeoutMs ?? REALTIME_CONFIG.preflight.iceGatherTimeoutMs, options.signal, logger), REALTIME_CONFIG.preflight.rtt);
	} };
}
//#endregion
export { createReactNativePreflight };
