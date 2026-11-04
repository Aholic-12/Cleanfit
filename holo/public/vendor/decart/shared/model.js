import { createModelNotFoundError } from "../utils/errors.js";
import { globalInstanceSchema } from "../utils/runtime.js";
import { z } from "zod";
//#region src/shared/model.ts
const CANONICAL_MODEL_NAMES = [
	"lucy-2.1",
	"lucy-2.5",
	"lucy-2.6",
	"lucy-vton-3.5",
	"lucy-vton-3.6",
	"lucy-restyle-2",
	"lucy-image-2"
];
const CANONICAL_REALTIME_MODEL_NAMES = [
	"lucy-2.1",
	"lucy-2.5",
	"lucy-2.6",
	"lucy-vton-3.5",
	"lucy-vton-3.6",
	"lucy-restyle-2"
];
const CANONICAL_VIDEO_MODEL_NAMES = [
	"lucy-2.1",
	"lucy-2.5",
	"lucy-2.6",
	"lucy-vton-3.5",
	"lucy-vton-3.6",
	"lucy-restyle-2"
];
const CANONICAL_IMAGE_MODEL_NAMES = ["lucy-image-2"];
const canonicalRealtimeModels = z.enum(CANONICAL_REALTIME_MODEL_NAMES);
const canonicalVideoModels = z.enum(CANONICAL_VIDEO_MODEL_NAMES);
const canonicalImageModels = z.enum(CANONICAL_IMAGE_MODEL_NAMES);
const canonicalModelSchema = z.enum(CANONICAL_MODEL_NAMES);
/**
* Map of deprecated model names to their canonical replacements.
* Old names still work but will log a deprecation warning.
*/
const modelAliases = {
	"lucy-restyle-v2v": "lucy-restyle-2",
	"lucy-pro-i2i": "lucy-image-2"
};
const _warnedAliases = /* @__PURE__ */ new Set();
function warnDeprecated(model) {
	const canonical = modelAliases[model];
	if (canonical && !_warnedAliases.has(model)) {
		_warnedAliases.add(model);
		console.warn(`[Decart SDK] Model "${model}" is deprecated. Use "${canonical}" instead. See https://docs.platform.decart.ai/models for details.`);
	}
}
const realtimeModels = z.union([
	z.literal("lucy-2.1"),
	z.literal("lucy-2.5"),
	z.literal("lucy-2.6"),
	z.literal("lucy-vton-3.5"),
	z.literal("lucy-vton-3.6"),
	z.literal("lucy-restyle-2"),
	z.literal("lucy-latest"),
	z.literal("lucy-vton-latest"),
	z.literal("lucy-restyle-latest")
]);
const videoModels = z.union([
	z.literal("lucy-2.1"),
	z.literal("lucy-2.5"),
	z.literal("lucy-2.6"),
	z.literal("lucy-vton-3.5"),
	z.literal("lucy-vton-3.6"),
	z.literal("lucy-restyle-2"),
	z.literal("lucy-latest"),
	z.literal("lucy-vton-latest"),
	z.literal("lucy-restyle-latest"),
	z.literal("lucy-restyle-v2v")
]);
const imageModels = z.union([
	z.literal("lucy-image-2"),
	z.literal("lucy-image-latest"),
	z.literal("lucy-pro-i2i")
]);
const modelSchema = z.union([
	realtimeModels,
	videoModels,
	imageModels
]);
function isRealtimeModel(model) {
	return realtimeModels.safeParse(model).success;
}
function isVideoModel(model) {
	return videoModels.safeParse(model).success;
}
function isImageModel(model) {
	return imageModels.safeParse(model).success;
}
function isModel(model) {
	return modelSchema.safeParse(model).success;
}
function isCanonicalModel(model) {
	return canonicalModelSchema.safeParse(model).success;
}
/**
* Resolve deprecated aliases to canonical model names and pass accepted model names through unchanged.
* Latest aliases pass through unchanged because they are server-side moving targets. This is a pure normalization helper
* and does not emit deprecation warnings.
*/
function resolveModelAlias(model) {
	const canonical = modelAliases[model];
	if (canonical) return canonical;
	const parsedModel = modelSchema.safeParse(model);
	return parsedModel.success ? parsedModel.data : void 0;
}
/**
* Resolve deprecated aliases and canonical inputs to stable canonical model names.
* Latest aliases are server-side moving targets, so they intentionally return undefined. This is a pure normalization
* helper and does not emit deprecation warnings.
*/
function resolveCanonicalModelAlias(model) {
	const canonical = modelAliases[model];
	if (canonical) return canonical;
	const parsedModel = canonicalModelSchema.safeParse(model);
	return parsedModel.success ? parsedModel.data : void 0;
}
const fileInputSchema = z.union([
	globalInstanceSchema("File"),
	globalInstanceSchema("Blob"),
	globalInstanceSchema("ReadableStream"),
	globalInstanceSchema("URL"),
	z.url(),
	z.object({
		uri: z.string(),
		type: z.string(),
		name: z.string()
	})
]);
/**
* Resolution schema for pro models.
* @param defaultValue - Optional default value (e.g., "720p")
*/
const proResolutionSchema = () => {
	return z.enum(["720p", "480p"]).optional().describe("The resolution to use for the generation").default("720p");
};
/**
* Resolution schema for video-to-video models (supports 720p).
*/
const v2vResolutionSchema = z.literal("720p").optional().describe("The resolution to use for the generation").default("720p");
const imageEditSchema = z.object({
	prompt: z.string().min(1).max(1e3).describe("The prompt to use for the generation"),
	data: fileInputSchema.describe("The image data to use for generation (File, Blob, ReadableStream, URL, or string URL)"),
	reference_image: fileInputSchema.optional().describe("Optional reference image to guide the edit (File, Blob, ReadableStream, URL, or string URL)"),
	seed: z.number().optional().describe("The seed to use for the generation"),
	resolution: proResolutionSchema(),
	enhance_prompt: z.boolean().optional().describe("Whether to enhance the prompt")
});
const restyleSchema = z.object({
	prompt: z.string().min(1).optional().describe("Text prompt for the video editing"),
	reference_image: fileInputSchema.optional().describe("Reference image to transform into a prompt (File, Blob, ReadableStream, URL, or string URL)"),
	data: fileInputSchema.describe("Video file to process (File, Blob, ReadableStream, URL, or string URL)"),
	seed: z.number().optional().describe("Seed for the video generation"),
	resolution: v2vResolutionSchema,
	enhance_prompt: z.boolean().optional().describe("Whether to enhance the prompt (only valid with text prompt, defaults to true on backend)")
}).refine((data) => data.prompt !== void 0 !== (data.reference_image !== void 0), { message: "Must provide either 'prompt' or 'reference_image', but not both" }).refine((data) => !(data.reference_image !== void 0 && data.enhance_prompt !== void 0), { message: "'enhance_prompt' is only valid when using 'prompt', not 'reference_image'" });
const videoEdit2Schema = z.object({
	prompt: z.string().describe("Text prompt for the video editing. Send an empty string if you want no text prompt."),
	reference_image: fileInputSchema.optional().describe("Optional reference image to guide the edit (File, Blob, ReadableStream, URL, or string URL)"),
	data: fileInputSchema.describe("Video file to process (File, Blob, ReadableStream, URL, or string URL)"),
	seed: z.number().optional().describe("The seed to use for the generation"),
	resolution: v2vResolutionSchema,
	enhance_prompt: z.boolean().optional().describe("Whether to enhance the prompt")
});
const modelInputSchemas = {
	"lucy-image-2": imageEditSchema,
	"lucy-restyle-2": restyleSchema,
	"lucy-2.1": videoEdit2Schema,
	"lucy-2.5": videoEdit2Schema,
	"lucy-2.6": videoEdit2Schema,
	"lucy-vton-3.5": videoEdit2Schema,
	"lucy-vton-3.6": videoEdit2Schema,
	"lucy-latest": videoEdit2Schema,
	"lucy-vton-latest": videoEdit2Schema,
	"lucy-restyle-latest": restyleSchema,
	"lucy-image-latest": imageEditSchema,
	"lucy-pro-i2i": imageEditSchema,
	"lucy-restyle-v2v": restyleSchema
};
/**
* Realtime speed tiers selectable with the `speed` connect option.
* `"fast"` is the only tier today; the standard tier has no value (omit the option).
*/
const realtimeSpeedSchema = z.enum(["fast"]);
function resolveFpsNumber(fps, fallback = 30) {
	if (typeof fps === "number") return fps;
	return fps.ideal ?? fps.max ?? fps.exact ?? fps.min ?? fallback;
}
const modelDefinitionSchema = z.object({
	name: z.string(),
	urlPath: z.string(),
	queueUrlPath: z.string().optional(),
	fps: z.union([z.number().min(1), z.object({
		max: z.number().min(1).optional(),
		min: z.number().min(1).optional(),
		ideal: z.number().min(1).optional(),
		exact: z.number().min(1).optional()
	})]),
	width: z.number().min(1),
	height: z.number().min(1),
	inputSchema: z.any().optional(),
	supportedSpeeds: z.array(realtimeSpeedSchema).readonly().optional()
});
const _models = {
	realtime: {
		"lucy-2.1": {
			urlPath: "/v1/stream",
			name: "lucy-2.1",
			fps: {
				ideal: 30,
				max: 30
			},
			width: 1280,
			height: 720,
			inputSchema: z.object({})
		},
		"lucy-2.5": {
			urlPath: "/v1/stream",
			name: "lucy-2.5",
			fps: {
				ideal: 30,
				max: 30
			},
			width: 1280,
			height: 720,
			inputSchema: z.object({}),
			supportedSpeeds: ["fast"]
		},
		"lucy-2.6": {
			urlPath: "/v1/stream",
			name: "lucy-2.6",
			fps: {
				ideal: 30,
				max: 30
			},
			width: 1280,
			height: 720,
			inputSchema: z.object({}),
			supportedSpeeds: ["fast"]
		},
		"lucy-vton-3.5": {
			urlPath: "/v1/stream",
			name: "lucy-vton-3.5",
			fps: {
				ideal: 30,
				max: 30
			},
			width: 1280,
			height: 720,
			inputSchema: z.object({}),
			supportedSpeeds: ["fast"]
		},
		"lucy-vton-3.6": {
			urlPath: "/v1/stream",
			name: "lucy-vton-3.6",
			fps: {
				ideal: 30,
				max: 30
			},
			width: 1280,
			height: 720,
			inputSchema: z.object({}),
			supportedSpeeds: ["fast"]
		},
		"lucy-restyle-2": {
			urlPath: "/v1/stream",
			name: "lucy-restyle-2",
			fps: {
				ideal: 30,
				max: 30
			},
			width: 1280,
			height: 704,
			inputSchema: z.object({})
		},
		"lucy-latest": {
			urlPath: "/v1/stream",
			name: "lucy-latest",
			fps: {
				ideal: 30,
				max: 30
			},
			width: 1280,
			height: 720,
			inputSchema: z.object({}),
			supportedSpeeds: ["fast"]
		},
		"lucy-vton-latest": {
			urlPath: "/v1/stream",
			name: "lucy-vton-latest",
			fps: {
				ideal: 30,
				max: 30
			},
			width: 1280,
			height: 720,
			inputSchema: z.object({}),
			supportedSpeeds: ["fast"]
		},
		"lucy-restyle-latest": {
			urlPath: "/v1/stream",
			name: "lucy-restyle-latest",
			fps: {
				ideal: 30,
				max: 30
			},
			width: 1280,
			height: 704,
			inputSchema: z.object({})
		}
	},
	image: {
		"lucy-image-2": {
			urlPath: "/v1/generate/lucy-image-2",
			queueUrlPath: "/v1/jobs/lucy-image-2",
			name: "lucy-image-2",
			fps: 25,
			width: 1280,
			height: 704,
			inputSchema: modelInputSchemas["lucy-image-2"]
		},
		"lucy-image-latest": {
			urlPath: "/v1/generate/lucy-image-latest",
			queueUrlPath: "/v1/jobs/lucy-image-latest",
			name: "lucy-image-latest",
			fps: 25,
			width: 1280,
			height: 704,
			inputSchema: modelInputSchemas["lucy-image-latest"]
		},
		"lucy-pro-i2i": {
			urlPath: "/v1/generate/lucy-pro-i2i",
			queueUrlPath: "/v1/jobs/lucy-pro-i2i",
			name: "lucy-pro-i2i",
			fps: 25,
			width: 1280,
			height: 704,
			inputSchema: modelInputSchemas["lucy-pro-i2i"]
		}
	},
	video: {
		"lucy-2.1": {
			urlPath: "/v1/generate/lucy-2.1",
			queueUrlPath: "/v1/jobs/lucy-2.1",
			name: "lucy-2.1",
			fps: 20,
			width: 1280,
			height: 720,
			inputSchema: modelInputSchemas["lucy-2.1"]
		},
		"lucy-2.5": {
			urlPath: "/v1/generate/lucy-2.5",
			queueUrlPath: "/v1/jobs/lucy-2.5",
			name: "lucy-2.5",
			fps: 20,
			width: 1280,
			height: 720,
			inputSchema: modelInputSchemas["lucy-2.5"]
		},
		"lucy-2.6": {
			urlPath: "/v1/generate/lucy-2.6",
			queueUrlPath: "/v1/jobs/lucy-2.6",
			name: "lucy-2.6",
			fps: 20,
			width: 1280,
			height: 720,
			inputSchema: modelInputSchemas["lucy-2.6"]
		},
		"lucy-vton-3.5": {
			urlPath: "/v1/generate/lucy-vton-3.5",
			queueUrlPath: "/v1/jobs/lucy-vton-3.5",
			name: "lucy-vton-3.5",
			fps: 20,
			width: 1280,
			height: 720,
			inputSchema: modelInputSchemas["lucy-vton-3.5"]
		},
		"lucy-vton-3.6": {
			urlPath: "/v1/generate/lucy-vton-3.6",
			queueUrlPath: "/v1/jobs/lucy-vton-3.6",
			name: "lucy-vton-3.6",
			fps: 20,
			width: 1280,
			height: 720,
			inputSchema: modelInputSchemas["lucy-vton-3.6"]
		},
		"lucy-restyle-2": {
			urlPath: "/v1/generate/lucy-restyle-2",
			queueUrlPath: "/v1/jobs/lucy-restyle-2",
			name: "lucy-restyle-2",
			fps: 22,
			width: 1280,
			height: 704,
			inputSchema: modelInputSchemas["lucy-restyle-2"]
		},
		"lucy-latest": {
			urlPath: "/v1/generate/lucy-latest",
			queueUrlPath: "/v1/jobs/lucy-latest",
			name: "lucy-latest",
			fps: 20,
			width: 1280,
			height: 720,
			inputSchema: modelInputSchemas["lucy-latest"]
		},
		"lucy-vton-latest": {
			urlPath: "/v1/generate/lucy-vton-latest",
			queueUrlPath: "/v1/jobs/lucy-vton-latest",
			name: "lucy-vton-latest",
			fps: 20,
			width: 1280,
			height: 720,
			inputSchema: modelInputSchemas["lucy-vton-latest"]
		},
		"lucy-restyle-latest": {
			urlPath: "/v1/generate/lucy-restyle-latest",
			queueUrlPath: "/v1/jobs/lucy-restyle-latest",
			name: "lucy-restyle-latest",
			fps: 22,
			width: 1280,
			height: 704,
			inputSchema: modelInputSchemas["lucy-restyle-latest"]
		},
		"lucy-restyle-v2v": {
			urlPath: "/v1/generate/lucy-restyle-v2v",
			queueUrlPath: "/v1/jobs/lucy-restyle-v2v",
			name: "lucy-restyle-v2v",
			fps: 22,
			width: 1280,
			height: 704,
			inputSchema: modelInputSchemas["lucy-restyle-v2v"]
		}
	}
};
const modelKinds = [
	"realtime",
	"video",
	"image"
];
const canonicalSchemasByKind = {
	realtime: canonicalRealtimeModels,
	video: canonicalVideoModels,
	image: canonicalImageModels
};
/**
* List SDK model definitions by kind.
* When canonicalOnly is true, deprecated and latest aliases are excluded per kind. Models available in multiple kinds
* are returned once per kind with the same name and different kind values.
*/
function listModels(options = {}) {
	return (options.kind ? [options.kind] : modelKinds).flatMap((kind) => {
		return Object.values(_models[kind]).filter((modelDefinition) => !options.canonicalOnly || canonicalSchemasByKind[kind].safeParse(modelDefinition.name).success).map((modelDefinition) => ({
			...modelDefinition,
			kind
		}));
	});
}
const models = {
	/**
	* Get a realtime streaming model identifier.
	*
	* Available options:
	*   - `"lucy-2.1"` - Lucy 2.1 realtime video editing
	*   - `"lucy-2.5"` - Lucy 2.5 realtime video editing
	*   - `"lucy-2.6"` - Lucy 2.6 realtime video editing
	*   - `"lucy-vton-3.5"` - Lucy virtual try-on 3.5
	*   - `"lucy-vton-3.6"` - Lucy virtual try-on 3.6
	*   - `"lucy-restyle-2"` - Realtime video restyling
	*/
	realtime: (model) => {
		warnDeprecated(model);
		const modelDefinition = _models.realtime[model];
		if (!modelDefinition) throw createModelNotFoundError(model);
		return modelDefinition;
	},
	/**
	* Get a video model identifier.
	*
	* Available options:
	*   - `"lucy-2.1"` - Long-form video editing (Lucy 2.1)
	*   - `"lucy-2.5"` - Long-form video editing (Lucy 2.5)
	*   - `"lucy-2.6"` - Long-form video editing (Lucy 2.6)
	*   - `"lucy-vton-3.5"` - Virtual try-on 3.5 video editing
	*   - `"lucy-vton-3.6"` - Virtual try-on 3.6 video editing
	*   - `"lucy-restyle-2"` - Video restyling
	*/
	video: (model) => {
		warnDeprecated(model);
		const modelDefinition = _models.video[model];
		if (!modelDefinition) throw createModelNotFoundError(model);
		return modelDefinition;
	},
	/**
	* Get an image model identifier.
	*
	* Available options:
	*   - `"lucy-image-2"` - Image-to-image editing
	*/
	image: (model) => {
		warnDeprecated(model);
		const modelDefinition = _models.image[model];
		if (!modelDefinition) throw createModelNotFoundError(model);
		return modelDefinition;
	}
};
//#endregion
export { canonicalImageModels, canonicalModelSchema, canonicalRealtimeModels, canonicalVideoModels, imageModels, isCanonicalModel, isImageModel, isModel, isRealtimeModel, isVideoModel, listModels, modelAliases, modelDefinitionSchema, modelInputSchemas, modelSchema, models, realtimeModels, realtimeSpeedSchema, resolveCanonicalModelAlias, resolveFpsNumber, resolveModelAlias, videoModels };
