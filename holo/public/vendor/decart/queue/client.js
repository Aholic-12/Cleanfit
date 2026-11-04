import { createInvalidInputError } from "../utils/errors.js";
import { fileInputToBlob } from "../shared/request.js";
import { pollUntilComplete } from "./polling.js";
import { getJobContent, getJobStatus, submitJob } from "./request.js";
//#region src/queue/client.ts
const createQueueClient = (opts) => {
	const { getApiKey, baseUrl, integration } = opts;
	const submit = async (options) => {
		const { model, signal, ...inputs } = options;
		const parsedInputs = model.inputSchema.safeParse(inputs);
		if (!parsedInputs.success) throw createInvalidInputError(`Invalid inputs for ${model.name}: ${parsedInputs.error.message}`);
		const processedInputs = {};
		for (const [key, value] of Object.entries(parsedInputs.data)) if (key === "data" || key === "start" || key === "end" || key === "reference_image") processedInputs[key] = await fileInputToBlob(value);
		else processedInputs[key] = value;
		return submitJob({
			baseUrl,
			apiKey: await getApiKey(),
			model,
			inputs: processedInputs,
			signal,
			integration
		});
	};
	const status = async (jobId) => {
		return getJobStatus({
			baseUrl,
			apiKey: await getApiKey(),
			jobId,
			integration
		});
	};
	const result = async (jobId) => {
		return getJobContent({
			baseUrl,
			apiKey: await getApiKey(),
			jobId,
			integration
		});
	};
	const submitAndPoll = async (options) => {
		const { onStatusChange, signal, ...submitOptions } = options;
		const job = await submit(submitOptions);
		if (onStatusChange) onStatusChange(job);
		return pollUntilComplete({
			checkStatus: async () => getJobStatus({
				baseUrl,
				apiKey: await getApiKey(),
				jobId: job.job_id,
				signal,
				integration
			}),
			getContent: async () => getJobContent({
				baseUrl,
				apiKey: await getApiKey(),
				jobId: job.job_id,
				signal,
				integration
			}),
			onStatusChange,
			signal
		});
	};
	return {
		submit,
		status,
		result,
		submitAndPoll
	};
};
//#endregion
export { createQueueClient };
