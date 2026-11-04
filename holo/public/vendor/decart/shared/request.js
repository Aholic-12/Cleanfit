import { createInvalidInputError } from "../utils/errors.js";
import { isGlobalInstance } from "../utils/runtime.js";
import { buildUserAgent } from "../utils/user-agent.js";
//#region src/shared/request.ts
/**
* Type guard to check if a value is a React Native file object.
*/
function isReactNativeFile(value) {
	return typeof value === "object" && value !== null && typeof value.uri === "string" && typeof value.type === "string" && typeof value.name === "string";
}
/**
* Convert various file input types to a Blob or React Native file object.
* React Native file objects are passed through as-is for proper FormData handling.
*/
async function fileInputToBlob(input) {
	if (isReactNativeFile(input)) return input;
	if (isGlobalInstance(input, "Blob") || isGlobalInstance(input, "File")) return input;
	if (isGlobalInstance(input, "ReadableStream")) return new Response(input).blob();
	if (typeof input === "string" || isGlobalInstance(input, "URL")) {
		const url = typeof input === "string" ? input : input.toString();
		if (!url.startsWith("http://") && !url.startsWith("https://")) throw createInvalidInputError("URL must start with http:// or https://");
		const response = await fetch(url);
		if (!response.ok) throw createInvalidInputError(`Failed to fetch file from URL: ${response.statusText}`);
		return response.blob();
	}
	throw createInvalidInputError("Invalid file input type");
}
/**
* Read an error response body for an SDK error message. The API returns JSON
* like {"detail": "Prompt is too long: ..."} — surface the human-readable
* detail instead of the raw JSON when present.
*/
async function readErrorBody(response) {
	const text = await response.text().catch(() => "");
	if (!text) return "Unknown error";
	try {
		const detail = JSON.parse(text).detail;
		if (typeof detail === "string" && detail) return detail;
	} catch {}
	return text;
}
/**
* Build common headers for API requests.
*/
function buildAuthHeaders(options = {}) {
	const { apiKey, integration } = options;
	return {
		"User-Agent": buildUserAgent(integration),
		...apiKey ? { "X-API-KEY": apiKey } : {}
	};
}
/**
* Build FormData from inputs object.
*/
function buildFormData(inputs) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(inputs)) if (value !== void 0 && value !== null) if (isReactNativeFile(value)) formData.append(key, value);
	else if (isGlobalInstance(value, "Blob")) formData.append(key, value);
	else if (typeof value === "object" && value !== null) formData.append(key, JSON.stringify(value));
	else formData.append(key, String(value));
	return formData;
}
//#endregion
export { buildAuthHeaders, buildFormData, fileInputToBlob, readErrorBody };
