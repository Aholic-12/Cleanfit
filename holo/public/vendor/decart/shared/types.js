import { globalInstanceSchema } from "../utils/runtime.js";
import { z } from "zod";
//#region src/shared/types.ts
const modelStateSchema = z.object({
	prompt: z.object({
		text: z.string().min(1),
		enhance: z.boolean().optional().default(true)
	}).optional(),
	/**
	* Initial image for the session. Pass either bytes (`Blob`/`File`/data URL/
	* http(s) URL/base64 string) or a `"file_..."` id returned by
	* `client.files.upload(...)`.id — the SDK detects the prefix and sends a
	* server-side reference instead of base64.
	*/
	image: z.union([
		globalInstanceSchema("Blob"),
		globalInstanceSchema("File"),
		z.string()
	]).optional(),
	passthrough: z.boolean().optional()
});
//#endregion
export { modelStateSchema };
