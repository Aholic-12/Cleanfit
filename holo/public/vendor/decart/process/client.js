import { createInvalidInputError } from "../utils/errors.js";
import { fileInputToBlob } from "../shared/request.js";
import { sendRequest } from "./request.js";
//#region src/process/client.ts
const createProcessClient = (opts) => {
	const { getApiKey, baseUrl, integration } = opts;
	const _process = async (options) => {
		const { model, signal, ...inputs } = options;
		const parsedInputs = model.inputSchema.safeParse(inputs);
		if (!parsedInputs.success) throw createInvalidInputError(`Invalid inputs for ${model.name}: ${parsedInputs.error.message}`);
		const processedInputs = {};
		for (const [key, value] of Object.entries(parsedInputs.data)) if (key === "data" || key === "start" || key === "end" || key === "reference_image") processedInputs[key] = await fileInputToBlob(value);
		else processedInputs[key] = value;
		return await sendRequest({
			baseUrl,
			apiKey: await getApiKey(),
			model,
			inputs: processedInputs,
			signal,
			integration
		});
	};
	return _process;
};
//#endregion
export { createProcessClient };
