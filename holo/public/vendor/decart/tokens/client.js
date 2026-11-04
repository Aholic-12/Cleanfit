import { createSDKError } from "../utils/errors.js";
import { buildAuthHeaders } from "../shared/request.js";
import { decodeClientToken } from "./claims.js";
import { verifyClientToken } from "./verify.js";
//#region src/tokens/client.ts
const createTokensClient = (opts) => {
	const { baseUrl, getApiKey, integration } = opts;
	const create = async (options) => {
		const headers = {
			...buildAuthHeaders({
				apiKey: await getApiKey(),
				integration
			}),
			"content-type": "application/json"
		};
		const response = await fetch(`${baseUrl}/v1/client/tokens`, {
			method: "POST",
			headers,
			body: JSON.stringify(options ?? {})
		});
		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");
			throw createSDKError("TOKEN_CREATE_ERROR", `Failed to create token: ${response.status} - ${errorText}`, { status: response.status });
		}
		return response.json();
	};
	return {
		create,
		verify: verifyClientToken,
		decode: decodeClientToken
	};
};
//#endregion
export { createTokensClient };
