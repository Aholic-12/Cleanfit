import { createRealTimeClient } from "../client.js";
import { createRealTimeSubscribeClient } from "../subscribe-client.js";
import { createFrameMetadataWorker, isFrameMetadataRuntimeSupported } from "./frame-metadata-diagnostics.js";
import { createPreflight } from "./preflight.js";
import { prepareBrowserConnection } from "./prepare-connection.js";
//#region src/realtime/browser/index.ts
const createBrowserRealtime = (options) => {
	const publish = createRealTimeClient({
		baseUrl: options.publishBaseUrl,
		apiKey: options.apiKey,
		apiKeyProvider: options.apiKeyProvider,
		integration: options.integration,
		logger: options.logger,
		telemetryEnabled: options.telemetryEnabled,
		prepareConnection: prepareBrowserConnection
	});
	const subscribe = createRealTimeSubscribeClient({
		baseUrl: options.subscribeBaseUrl,
		apiKey: options.apiKey,
		apiKeyProvider: options.apiKeyProvider,
		integration: options.integration,
		logger: options.logger,
		createFrameMetadataWorker,
		isFrameMetadataRuntimeSupported
	});
	const preflight = createPreflight({
		logger: options.logger,
		connect: publish.connect
	});
	return {
		connect: (stream, connectOptions) => publish.connect(stream, connectOptions),
		subscribe: subscribe.subscribe,
		checkConnectivity: preflight.checkConnectivity
	};
};
//#endregion
export { createBrowserRealtime };
