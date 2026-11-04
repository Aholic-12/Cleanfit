import { createReactNativeSetupRequiredError, createUnsupportedPlatformFeatureError } from "../../utils/errors.js";
import { RealtimeObservability } from "../observability/realtime-observability.js";
import { missingReactNativeRealtimeGlobals } from "../../utils/platform.js";
import { createLiveKitMediaChannel } from "../media-channel.js";
//#region src/realtime/react-native/prepare-connection.ts
function assertReactNativeReady() {
	const missing = missingReactNativeRealtimeGlobals();
	if (missing.length > 0) throw createReactNativeSetupRequiredError(missing);
}
function unsupportedReactNativeFeature(feature) {
	throw createUnsupportedPlatformFeatureError(feature, "React Native");
}
const prepareReactNativeConnection = ({ stream, mirror, preferredVideoCodec, observability: observabilityOptions }) => {
	assertReactNativeReady();
	if (mirror !== false) unsupportedReactNativeFeature("Outgoing video mirroring");
	return {
		stream: stream ?? new MediaStream(),
		observability: new RealtimeObservability(observabilityOptions),
		videoCodec: preferredVideoCodec,
		createMediaChannel: createLiveKitMediaChannel,
		dispose: () => {}
	};
};
//#endregion
export { assertReactNativeReady, prepareReactNativeConnection, unsupportedReactNativeFeature };
