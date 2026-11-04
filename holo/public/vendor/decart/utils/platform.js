//#region src/utils/platform.ts
const REACT_NATIVE_REALTIME_GLOBALS = [
	"LiveKitReactNativeGlobal",
	"RTCPeerConnection",
	"MediaStream",
	"MediaStreamTrack",
	"DOMException",
	"ReadableStream",
	"WritableStream",
	"TransformStream",
	"URL",
	"URLSearchParams"
];
function missingReactNativeRealtimeGlobals() {
	const g = globalThis;
	return REACT_NATIVE_REALTIME_GLOBALS.filter((name) => g[name] === void 0);
}
function isDesktopSafari() {
	const g = globalThis;
	const ua = g?.navigator?.userAgent ?? "";
	const platform = g?.navigator?.platform ?? "";
	const maxTouchPoints = g?.navigator?.maxTouchPoints ?? 0;
	if (!/^((?!chrome|chromium|crios|fxios|edg|firefox|opr|opera|android).)*safari/i.test(ua)) return false;
	if (/iPad|iPhone|iPod/.test(ua)) return false;
	if (platform === "MacIntel" && maxTouchPoints > 1) return false;
	return true;
}
//#endregion
export { isDesktopSafari, missingReactNativeRealtimeGlobals };
