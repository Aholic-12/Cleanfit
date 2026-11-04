import { createRealTimeClient } from "../client.js";
import { createRealTimeSubscribeClient } from "../subscribe-client.js";
import { createReactNativePreflight } from "./preflight.js";
import { assertReactNativeReady, prepareReactNativeConnection, unsupportedReactNativeFeature } from "./prepare-connection.js";
//#region src/realtime/react-native/index.ts
const createReactNativeRealtime = (options) => {
	const publish = createRealTimeClient({
		baseUrl: options.publishBaseUrl,
		apiKey: options.apiKey,
		apiKeyProvider: options.apiKeyProvider,
		integration: options.integration,
		logger: options.logger,
		telemetryEnabled: options.telemetryEnabled,
		prepareConnection: prepareReactNativeConnection
	});
	const subscribe = createRealTimeSubscribeClient({
		baseUrl: options.subscribeBaseUrl,
		apiKey: options.apiKey,
		apiKeyProvider: options.apiKeyProvider,
		integration: options.integration,
		logger: options.logger
	});
	const preflight = createReactNativePreflight({ logger: options.logger });
	return {
		connect: (stream, connectOptions) => publish.connect(stream, connectOptions),
		subscribe: (subscribeOptions) => {
			assertReactNativeReady();
			return subscribe.subscribe(subscribeOptions);
		},
		checkConnectivity: async (checkOptions = {}) => {
			assertReactNativeReady();
			if (checkOptions.deep) unsupportedReactNativeFeature("Deep connectivity preflight");
			return preflight.checkConnectivity(checkOptions);
		}
	};
};
//#endregion
export { createReactNativeRealtime };
