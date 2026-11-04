import { createSDKError } from "../utils/errors.js";
import { buildAuthHeaders, buildFormData, readErrorBody } from "../shared/request.js";
//#region src/process/request.ts
async function sendRequest({ baseUrl, apiKey, model, inputs, signal, integration }) {
	const formData = buildFormData(inputs);
	const endpoint = `${baseUrl}${model.urlPath}`;
	const headers = buildAuthHeaders({
		apiKey,
		integration
	});
	const response = await fetch(endpoint, {
		method: "POST",
		headers,
		body: formData,
		signal
	});
	if (!response.ok) {
		const errorText = await readErrorBody(response);
		throw createSDKError("PROCESSING_ERROR", `Processing failed: ${response.status} - ${errorText}`);
	}
	return response.blob();
}
//#endregion
export { sendRequest };
