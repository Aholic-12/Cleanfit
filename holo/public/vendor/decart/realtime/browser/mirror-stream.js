//#region src/realtime/browser/mirror-stream.ts
function isMediaStreamTrackProcessorSupported() {
	return typeof globalThis !== "undefined" && typeof globalThis.MediaStreamTrackProcessor === "function" && typeof globalThis.MediaStreamTrackGenerator === "function";
}
function shouldMirrorTrack(track) {
	if (track.kind !== "video") return false;
	let facingMode;
	try {
		facingMode = track.getSettings?.().facingMode;
	} catch {
		return false;
	}
	return facingMode === "user";
}
/**
* Wrap `input`'s video track so each published frame passes through `transform`.
* Uses Insertable Streams (frame-accurate) where supported, a canvas
* `captureStream` pump otherwise. No-ops (returns `input` unchanged) when there
* is no video track. Audio tracks pass through untouched.
*/
function createFrameTransformPump(input, opts) {
	const [sourceVideo] = input.getVideoTracks();
	const audioTracks = input.getAudioTracks();
	if (!sourceVideo) return {
		stream: input,
		dispose: () => {},
		impl: "noop"
	};
	if (isMediaStreamTrackProcessorSupported()) return createWithTrackProcessor(sourceVideo, audioTracks, opts.transform);
	return createWithCanvas(sourceVideo, audioTracks, opts.fps, opts.transform);
}
function createMirroredStream(input, opts) {
	return createFrameTransformPump(input, {
		fps: opts.fps,
		transform: (ctx, source, w, h) => {
			ctx.save();
			ctx.setTransform(-1, 0, 0, 1, w, 0);
			ctx.drawImage(source, 0, 0, w, h);
			ctx.restore();
		}
	});
}
function createWithTrackProcessor(sourceVideo, audioTracks, transform) {
	const Processor = globalThis.MediaStreamTrackProcessor;
	const Generator = globalThis.MediaStreamTrackGenerator;
	if (!new OffscreenCanvas(1, 1).getContext("2d")) throw new Error("createFrameTransformPump: OffscreenCanvas 2D context unavailable");
	const processor = new Processor({ track: sourceVideo });
	const generator = new Generator({ kind: "video" });
	let canvas = new OffscreenCanvas(1, 1);
	let ctx = canvas.getContext("2d");
	const pipeline = new TransformStream({ transform(frame, controller) {
		const w = frame.displayWidth;
		const h = frame.displayHeight;
		if (canvas.width !== w || canvas.height !== h) {
			canvas = new OffscreenCanvas(w, h);
			ctx = canvas.getContext("2d");
		}
		let out;
		try {
			transform(ctx, frame, w, h);
			out = new VideoFrame(canvas, {
				timestamp: frame.timestamp,
				alpha: "discard"
			});
			controller.enqueue(out);
			out = void 0;
		} finally {
			out?.close();
			frame.close();
		}
	} });
	processor.readable.pipeThrough(pipeline).pipeTo(generator.writable).catch(() => {});
	let disposed = false;
	return {
		stream: new MediaStream([generator, ...audioTracks]),
		impl: "track-processor",
		dispose: () => {
			if (disposed) return;
			disposed = true;
			generator.stop();
		}
	};
}
function createWithCanvas(sourceVideo, audioTracks, fps, transform) {
	if (typeof document === "undefined") throw new Error("createFrameTransformPump requires a DOM environment (document is undefined)");
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("createFrameTransformPump: 2D canvas context unavailable");
	if (typeof canvas.captureStream !== "function") throw new Error("createFrameTransformPump: canvas.captureStream unavailable");
	const [outTrack] = canvas.captureStream(fps).getVideoTracks();
	if (!outTrack) throw new Error("createFrameTransformPump: canvas.captureStream produced no video track");
	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.autoplay = true;
	video.srcObject = new MediaStream([sourceVideo]);
	let disposed = false;
	let rafHandle = null;
	const draw = () => {
		if (disposed) return;
		const w = video.videoWidth;
		const h = video.videoHeight;
		if (w > 0 && h > 0) {
			if (canvas.width !== w) canvas.width = w;
			if (canvas.height !== h) canvas.height = h;
			transform(ctx, video, w, h);
		}
		rafHandle = requestAnimationFrame(draw);
	};
	video.play().catch(() => {});
	rafHandle = requestAnimationFrame(draw);
	return {
		stream: new MediaStream([outTrack, ...audioTracks]),
		impl: "canvas",
		dispose: () => {
			if (disposed) return;
			disposed = true;
			if (rafHandle !== null) cancelAnimationFrame(rafHandle);
			outTrack.stop();
			video.srcObject = null;
		}
	};
}
//#endregion
export { createFrameTransformPump, createMirroredStream, isMediaStreamTrackProcessorSupported, shouldMirrorTrack };
