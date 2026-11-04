import { z } from "zod";

//#region src/shared/model.d.ts

declare const canonicalModelSchema: z.ZodEnum<{
  "lucy-2.1": "lucy-2.1";
  "lucy-2.5": "lucy-2.5";
  "lucy-2.6": "lucy-2.6";
  "lucy-vton-3.5": "lucy-vton-3.5";
  "lucy-vton-3.6": "lucy-vton-3.6";
  "lucy-restyle-2": "lucy-restyle-2";
  "lucy-image-2": "lucy-image-2";
}>;
type CanonicalModel = z.infer<typeof canonicalModelSchema>;
/**
 * Map of deprecated model names to their canonical replacements.
 * Old names still work but will log a deprecation warning.
 */
declare const modelAliases: {
  readonly "lucy-restyle-v2v": "lucy-restyle-2";
  readonly "lucy-pro-i2i": "lucy-image-2";
};
/** @internal Test-only helper to reset deprecation warning tracking */

declare const realtimeModels: z.ZodUnion<readonly [z.ZodLiteral<"lucy-2.1">, z.ZodLiteral<"lucy-2.5">, z.ZodLiteral<"lucy-2.6">, z.ZodLiteral<"lucy-vton-3.5">, z.ZodLiteral<"lucy-vton-3.6">, z.ZodLiteral<"lucy-restyle-2">, z.ZodLiteral<"lucy-latest">, z.ZodLiteral<"lucy-vton-latest">, z.ZodLiteral<"lucy-restyle-latest">]>;
declare const videoModels: z.ZodUnion<readonly [z.ZodLiteral<"lucy-2.1">, z.ZodLiteral<"lucy-2.5">, z.ZodLiteral<"lucy-2.6">, z.ZodLiteral<"lucy-vton-3.5">, z.ZodLiteral<"lucy-vton-3.6">, z.ZodLiteral<"lucy-restyle-2">, z.ZodLiteral<"lucy-latest">, z.ZodLiteral<"lucy-vton-latest">, z.ZodLiteral<"lucy-restyle-latest">, z.ZodLiteral<"lucy-restyle-v2v">]>;
declare const imageModels: z.ZodUnion<readonly [z.ZodLiteral<"lucy-image-2">, z.ZodLiteral<"lucy-image-latest">, z.ZodLiteral<"lucy-pro-i2i">]>;
declare const modelSchema: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodLiteral<"lucy-2.1">, z.ZodLiteral<"lucy-2.5">, z.ZodLiteral<"lucy-2.6">, z.ZodLiteral<"lucy-vton-3.5">, z.ZodLiteral<"lucy-vton-3.6">, z.ZodLiteral<"lucy-restyle-2">, z.ZodLiteral<"lucy-latest">, z.ZodLiteral<"lucy-vton-latest">, z.ZodLiteral<"lucy-restyle-latest">]>, z.ZodUnion<readonly [z.ZodLiteral<"lucy-2.1">, z.ZodLiteral<"lucy-2.5">, z.ZodLiteral<"lucy-2.6">, z.ZodLiteral<"lucy-vton-3.5">, z.ZodLiteral<"lucy-vton-3.6">, z.ZodLiteral<"lucy-restyle-2">, z.ZodLiteral<"lucy-latest">, z.ZodLiteral<"lucy-vton-latest">, z.ZodLiteral<"lucy-restyle-latest">, z.ZodLiteral<"lucy-restyle-v2v">]>, z.ZodUnion<readonly [z.ZodLiteral<"lucy-image-2">, z.ZodLiteral<"lucy-image-latest">, z.ZodLiteral<"lucy-pro-i2i">]>]>;
type Model = z.infer<typeof modelSchema>;
type RealTimeModels = z.infer<typeof realtimeModels>;
type VideoModels = z.infer<typeof videoModels>;
type ImageModels = z.infer<typeof imageModels>;
declare function isRealtimeModel(model: string): model is RealTimeModels;
declare function isVideoModel(model: string): model is VideoModels;
declare function isImageModel(model: string): model is ImageModels;
declare function isModel(model: string): model is Model;
declare function isCanonicalModel(model: string): model is CanonicalModel;
/**
 * Resolve deprecated aliases to canonical model names and pass accepted model names through unchanged.
 * Latest aliases pass through unchanged because they are server-side moving targets. This is a pure normalization helper
 * and does not emit deprecation warnings.
 */
declare function resolveModelAlias(model: string): Model | undefined;
/**
 * Resolve deprecated aliases and canonical inputs to stable canonical model names.
 * Latest aliases are server-side moving targets, so they intentionally return undefined. This is a pure normalization
 * helper and does not emit deprecation warnings.
 */
declare function resolveCanonicalModelAlias(model: string): CanonicalModel | undefined;
declare const modelInputSchemas: {
  readonly "lucy-image-2": z.ZodObject<{
    prompt: z.ZodString;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
      "720p": "720p";
      "480p": "480p";
    }>>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-restyle-2": z.ZodObject<{
    prompt: z.ZodOptional<z.ZodString>;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodLiteral<"720p">>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-2.1": z.ZodObject<{
    prompt: z.ZodString;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodLiteral<"720p">>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-2.5": z.ZodObject<{
    prompt: z.ZodString;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodLiteral<"720p">>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-2.6": z.ZodObject<{
    prompt: z.ZodString;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodLiteral<"720p">>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-vton-3.5": z.ZodObject<{
    prompt: z.ZodString;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodLiteral<"720p">>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-vton-3.6": z.ZodObject<{
    prompt: z.ZodString;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodLiteral<"720p">>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-latest": z.ZodObject<{
    prompt: z.ZodString;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodLiteral<"720p">>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-vton-latest": z.ZodObject<{
    prompt: z.ZodString;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodLiteral<"720p">>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-restyle-latest": z.ZodObject<{
    prompt: z.ZodOptional<z.ZodString>;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodLiteral<"720p">>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-image-latest": z.ZodObject<{
    prompt: z.ZodString;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
      "720p": "720p";
      "480p": "480p";
    }>>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-pro-i2i": z.ZodObject<{
    prompt: z.ZodString;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
      "720p": "720p";
      "480p": "480p";
    }>>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
  readonly "lucy-restyle-v2v": z.ZodObject<{
    prompt: z.ZodOptional<z.ZodString>;
    reference_image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>>;
    data: z.ZodUnion<readonly [z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<ReadableStream<any>, unknown, z.core.$ZodTypeInternals<ReadableStream<any>, unknown>>, z.ZodType<URL, unknown, z.core.$ZodTypeInternals<URL, unknown>>, z.ZodURL, z.ZodObject<{
      uri: z.ZodString;
      type: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>]>;
    seed: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodDefault<z.ZodOptional<z.ZodLiteral<"720p">>>;
    enhance_prompt: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>;
};
type ModelInputSchemas = typeof modelInputSchemas;
type ModelFps = number | {
  max?: number;
  min?: number;
  ideal?: number;
  exact?: number;
};
/**
 * Realtime speed tiers selectable with the `speed` connect option.
 * `"fast"` is the only tier today; the standard tier has no value (omit the option).
 */
declare const realtimeSpeedSchema: z.ZodEnum<{
  fast: "fast";
}>;
type RealtimeSpeed = z.infer<typeof realtimeSpeedSchema>;
type ModelDefinition<T extends Model = Model> = {
  name: T;
  urlPath: string;
  queueUrlPath?: string;
  fps: ModelFps;
  width: number;
  height: number;
  inputSchema: T extends keyof ModelInputSchemas ? ModelInputSchemas[T] : z.ZodTypeAny;
  /**
   * Realtime speed tiers this model can be served from via the `speed` connect option.
   * Absent when the model only offers the standard tier (the server ignores `speed` for it).
   */
  supportedSpeeds?: readonly RealtimeSpeed[];
};
declare function resolveFpsNumber(fps: ModelFps, fallback?: number): number;
/**
 * A model definition with an arbitrary (non-registry) model name.
 * Use this when providing your own model configuration.
 */
type CustomModelDefinition = Omit<ModelDefinition, "name" | "inputSchema"> & {
  name: string;
  inputSchema?: z.ZodTypeAny;
};
/**
 * Type alias for model definitions that support synchronous processing.
 * Only image models support the sync/process API.
 * Requires `queueUrlPath` to distinguish from realtime definitions of the same model name.
 */
type ImageModelDefinition = ModelDefinition<ImageModels> & {
  fps: number;
  queueUrlPath: string;
};
/**
 * Type alias for model definitions that support queue processing.
 * Only video models support the queue API.
 * Requires `queueUrlPath` to distinguish from realtime definitions of the same model name.
 */
type VideoModelDefinition = ModelDefinition<VideoModels> & {
  fps: number;
  queueUrlPath: string;
};
type ModelKind = "realtime" | "video" | "image";
type ListedModelDefinition = ModelDefinition & {
  kind: ModelKind;
};
/**
 * List SDK model definitions by kind.
 * When canonicalOnly is true, deprecated and latest aliases are excluded per kind. Models available in multiple kinds
 * are returned once per kind with the same name and different kind values.
 */
declare function listModels(options?: {
  kind?: ModelKind;
  canonicalOnly?: boolean;
}): ListedModelDefinition[];
declare const models: {
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
  realtime: <T extends RealTimeModels>(model: T) => ModelDefinition<T>;
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
  video: <T extends VideoModels>(model: T) => ModelDefinition<T> & {
    fps: number;
    queueUrlPath: string;
  };
  /**
   * Get an image model identifier.
   *
   * Available options:
   *   - `"lucy-image-2"` - Image-to-image editing
   */
  image: <T extends ImageModels>(model: T) => ModelDefinition<T> & {
    fps: number;
    queueUrlPath: string;
  };
};
//#endregion
export { CanonicalModel, CustomModelDefinition, ImageModelDefinition, ImageModels, ListedModelDefinition, Model, ModelDefinition, ModelFps, ModelInputSchemas, ModelKind, RealTimeModels, RealtimeSpeed, VideoModelDefinition, VideoModels, canonicalModelSchema, imageModels, isCanonicalModel, isImageModel, isModel, isRealtimeModel, isVideoModel, listModels, modelAliases, modelInputSchemas, modelSchema, models, realtimeModels, realtimeSpeedSchema, resolveCanonicalModelAlias, resolveFpsNumber, resolveModelAlias, videoModels };