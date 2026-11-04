import { createInvalidInputError, createSDKError } from "../utils/errors.js";
import { buildAuthHeaders } from "../shared/request.js";
import { z } from "zod";
//#region src/files/client.ts
const MAX_TTL_SECONDS = 720 * 60 * 60;
const ttlSecondsSchema = z.union([z.number().int().min(60).max(MAX_TTL_SECONDS), z.literal("persistent")]);
const MD5_HEX = /^[0-9a-f]{32}$/i;
const createFilesClient = (opts) => {
	const { baseUrl, getApiKey, integration } = opts;
	const upload = async (file, options) => {
		if (options?.ttlSeconds !== void 0) {
			if (!ttlSecondsSchema.safeParse(options.ttlSeconds).success) throw createInvalidInputError(`ttlSeconds must be an integer in [60, ${MAX_TTL_SECONDS}] or the literal "persistent"`);
		}
		const formData = new FormData();
		formData.append("file", file);
		if (options?.ttlSeconds !== void 0) formData.append("ttl_seconds", String(options.ttlSeconds));
		const response = await fetch(`${baseUrl}/v1/files`, {
			method: "POST",
			headers: buildAuthHeaders({
				apiKey: await getApiKey(),
				integration
			}),
			body: formData,
			signal: options?.signal
		});
		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");
			throw createSDKError("FILES_UPLOAD_ERROR", `Failed to upload file: ${response.status} - ${errorText}`, { status: response.status });
		}
		return response.json();
	};
	const fetchReference = async (path) => {
		const response = await fetch(`${baseUrl}${path}`, {
			method: "GET",
			headers: buildAuthHeaders({
				apiKey: await getApiKey(),
				integration
			})
		});
		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");
			throw createSDKError("FILES_GET_ERROR", `Failed to get file: ${response.status} - ${errorText}`, { status: response.status });
		}
		return response.json();
	};
	const get = (fileId) => fetchReference(`/v1/files/${encodeURIComponent(fileId)}`);
	const getByMd5 = async (md5) => {
		if (!MD5_HEX.test(md5)) throw createInvalidInputError("md5 must be 32 hex characters");
		return fetchReference(`/v1/files/by-md5/${md5.toLowerCase()}`);
	};
	const deleteFile = async (fileId) => {
		const response = await fetch(`${baseUrl}/v1/files/${encodeURIComponent(fileId)}`, {
			method: "DELETE",
			headers: buildAuthHeaders({
				apiKey: await getApiKey(),
				integration
			})
		});
		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");
			throw createSDKError("FILES_DELETE_ERROR", `Failed to delete file: ${response.status} - ${errorText}`, { status: response.status });
		}
	};
	return {
		upload,
		get,
		getByMd5,
		delete: deleteFile
	};
};
//#endregion
export { createFilesClient };
