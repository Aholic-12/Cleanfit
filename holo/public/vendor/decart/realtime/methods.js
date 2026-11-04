import { globalInstanceSchema } from "../utils/runtime.js";
import { REALTIME_CONFIG } from "./config-realtime.js";
import { isFileRefId } from "../files/types.js";
import { z } from "zod";
//#region src/realtime/methods.ts
const setInputSchema = z.object({
	prompt: z.string().min(1).optional(),
	enhance: z.boolean().optional().default(true),
	/**
	* - `Blob`/`File`/data:/base64 string: bytes traverse the wire as base64.
	* - `http(s):` URL: fetched, then sent as base64. Browser-oriented — the fetch
	*   relies on the same-origin policy. Server-side, pass bytes rather than a
	*   caller-supplied URL (fetching an arbitrary URL from a server is an SSRF risk).
	* - `"file_..."` id (from `client.files.upload(...).id`): sent as a server-side reference.
	*/
	image: z.union([
		globalInstanceSchema("Blob"),
		globalInstanceSchema("File"),
		z.string(),
		z.null()
	]).optional()
}).refine((data) => data.prompt !== void 0 || data.image !== void 0, { message: "At least one of 'prompt' or 'image' must be provided" });
const setPromptInputSchema = z.object({
	prompt: z.string().min(1),
	enhance: z.boolean().optional().default(true)
});
const realtimeMethods = (session, imageToBase64) => {
	const set = async (input) => {
		const parsed = setInputSchema.safeParse(input);
		if (!parsed.success) throw parsed.error;
		const { prompt, enhance, image } = parsed.data;
		const options = {
			prompt,
			enhance,
			timeout: REALTIME_CONFIG.methods.updateTimeoutMs
		};
		if (isFileRefId(image)) {
			await session.setImage({
				kind: "ref",
				ref: image
			}, options);
			return;
		}
		const imageBase64 = image !== void 0 && image !== null ? await imageToBase64(image) : null;
		await session.setImage({
			kind: "data",
			data: imageBase64
		}, options);
	};
	const setPrompt = async (prompt, { enhance } = {}) => {
		const parsed = setPromptInputSchema.safeParse({
			prompt,
			enhance
		});
		if (!parsed.success) throw parsed.error;
		await session.sendPrompt(parsed.data.prompt, {
			enhance: parsed.data.enhance,
			timeout: REALTIME_CONFIG.methods.promptTimeoutMs
		});
	};
	const replaceVideoTrack = async (track) => {
		await session.replaceVideoTrack(track);
	};
	return {
		set,
		setPrompt,
		replaceVideoTrack
	};
};
//#endregion
export { realtimeMethods };
