import { createQueueResultError, createQueueStatusError, createQueueSubmitError } from "../utils/errors.js";
import { buildAuthHeaders, buildFormData, readErrorBody } from "../shared/request.js";
//#region src/queue/request.ts
/**
* Submit a job to the queue.
* POST /v1/jobs/{model}
*/
async function submitJob({ baseUrl, apiKey, model, inputs, signal, integration }) {
	const formData = buildFormData(inputs);
	if (!model.queueUrlPath) throw createQueueSubmitError(`Model ${model.name} does not support queue processing`, 400);
	const endpoint = `${baseUrl}${model.queueUrlPath}`;
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
		throw createQueueSubmitError(`Failed to submit job: ${response.status} - ${errorText}`, response.status);
	}
	return response.json();
}
/**
* Get the status of a job.
* GET /v1/jobs/{job_id}
*/
async function getJobStatus({ baseUrl, apiKey, jobId, signal, integration }) {
	const endpoint = `${baseUrl}/v1/jobs/${jobId}`;
	const headers = buildAuthHeaders({
		apiKey,
		integration
	});
	const response = await fetch(endpoint, {
		method: "GET",
		headers,
		signal
	});
	if (!response.ok) {
		const errorText = await readErrorBody(response);
		throw createQueueStatusError(`Failed to get job status: ${response.status} - ${errorText}`, response.status);
	}
	return response.json();
}
/**
* Get the content/result of a completed job.
* GET /v1/jobs/{job_id}/content
*/
async function getJobContent({ baseUrl, apiKey, jobId, signal, integration }) {
	const endpoint = `${baseUrl}/v1/jobs/${jobId}/content`;
	const headers = buildAuthHeaders({
		apiKey,
		integration
	});
	const response = await fetch(endpoint, {
		method: "GET",
		headers,
		signal
	});
	if (!response.ok) {
		const errorText = await readErrorBody(response);
		throw createQueueResultError(`Failed to get job content: ${response.status} - ${errorText}`, response.status);
	}
	return response.blob();
}
//#endregion
export { getJobContent, getJobStatus, submitJob };
