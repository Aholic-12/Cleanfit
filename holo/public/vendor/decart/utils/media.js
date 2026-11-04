//#region src/utils/media.ts
async function blobToBase64(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const result = reader.result;
			if (typeof result !== "string") {
				reject(/* @__PURE__ */ new Error("FileReader did not return a string"));
				return;
			}
			const base64 = result.split(",")[1];
			if (!base64) {
				reject(/* @__PURE__ */ new Error("Invalid data URL format"));
				return;
			}
			resolve(base64);
		};
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}
/**
* Normalizes an image input to a raw base64 string (no `data:` prefix).
*
* String inputs are interpreted by URL scheme:
* - `data:` URL — decoded locally.
* - `http:`/`https:` URL — fetched, then encoded. This is a browser-oriented
*   convenience that leans on the browser's same-origin policy to bound what
*   the fetch can read. Do NOT rely on it server-side (Node/SSR/edge) with a
*   caller-supplied URL: fetching an arbitrary URL from a server is an SSRF
*   vector, and this helper can't distinguish an internal host from an external
*   one. Server-side callers should pass binary (`Blob`/`File`) instead.
* - any other string that parses as a URL (e.g. `file:`, `blob:`, `ftp:`) — a
*   clear error, rather than being forwarded to the API as if it were base64.
* - a string that isn't a URL — assumed to already be raw base64.
*/
async function imageToBase64(image) {
	if (typeof image === "string") {
		let url = null;
		try {
			url = new URL(image);
		} catch {}
		if (url?.protocol === "data:") {
			const [, base64] = image.split(",", 2);
			if (!base64) throw new Error("Invalid data URL image");
			return base64;
		}
		if (url?.protocol === "http:" || url?.protocol === "https:") {
			const response = await fetch(image);
			if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
			return blobToBase64(await response.blob());
		}
		if (url) throw new Error(`Unsupported image URL scheme: ${url.protocol}`);
		return image;
	}
	return blobToBase64(image);
}
//#endregion
export { blobToBase64, imageToBase64 };
