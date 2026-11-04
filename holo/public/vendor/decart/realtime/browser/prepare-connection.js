import { RealtimeObservability } from "../observability/realtime-observability.js";
import { isDesktopSafari } from "../../utils/platform.js";
import { createLiveKitMediaChannel } from "../media-channel.js";
import { createBrowserFrameMetadataDiagnostics, createFrameMetadataWorker, isFrameMetadataRuntimeSupported } from "./frame-metadata-diagnostics.js";
import { createMirroredStream, shouldMirrorTrack } from "./mirror-stream.js";
//#region src/realtime/browser/prepare-connection.ts
const prepareBrowserConnection = ({ stream, mirror, preferredVideoCodec, fps, logger, observability: observabilityOptions }) => {
	let inputStream = stream ?? new MediaStream();
	let disposeMirroring = () => {};
	if (mirror !== false) try {
		const videoTrack = inputStream.getVideoTracks?.()[0];
		if (videoTrack && (mirror === true || shouldMirrorTrack(videoTrack))) {
			const mirrored = createMirroredStream(inputStream, { fps });
			inputStream = mirrored.stream;
			disposeMirroring = mirrored.dispose;
		} else if (mirror === true && !videoTrack) logger.warn("mirror: true requested but no video track was found on the input stream");
	} catch (error) {
		logger.warn("Failed to mirror input stream; falling back to un-mirrored input", { error: error instanceof Error ? error.message : String(error) });
	}
	let pendingWorker;
	if (isFrameMetadataRuntimeSupported()) try {
		pendingWorker = createFrameMetadataWorker();
	} catch (error) {
		logger.debug("Frame-metadata worker unavailable; glass-to-glass latency measurement disabled", { error: error instanceof Error ? error.message : String(error) });
	}
	else logger.debug("Frame-metadata runtime unavailable; glass-to-glass latency measurement disabled");
	const frameTiming = pendingWorker !== void 0;
	const takeFrameMetadataWorker = () => {
		if (pendingWorker) {
			const worker = pendingWorker;
			pendingWorker = void 0;
			return worker;
		}
		return createFrameMetadataWorker();
	};
	const observability = new RealtimeObservability({
		...observabilityOptions,
		glassToGlass: frameTiming ? createBrowserFrameMetadataDiagnostics() : void 0
	});
	const safariCodec = isDesktopSafari() ? "vp8" : void 0;
	return {
		stream: inputStream,
		observability,
		frameTiming,
		videoCodec: safariCodec ?? preferredVideoCodec,
		queryParams: { ...safariCodec ? { livekit_server_codec: safariCodec } : {} },
		createMediaChannel: (config) => createLiveKitMediaChannel({
			...config,
			createFrameMetadataWorker: frameTiming ? takeFrameMetadataWorker : void 0
		}),
		dispose: () => {
			disposeMirroring();
			pendingWorker?.terminate();
		}
	};
};
//#endregion
export { prepareBrowserConnection };
