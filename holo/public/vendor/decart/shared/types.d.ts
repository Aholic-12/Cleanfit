import { z } from "zod";

//#region src/shared/types.d.ts
declare const modelStateSchema: z.ZodObject<{
  prompt: z.ZodOptional<z.ZodObject<{
    text: z.ZodString;
    enhance: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
  }, z.core.$strip>>;
  image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodString]>>;
  passthrough: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
type ModelState = z.infer<typeof modelStateSchema>;
//#endregion
export { ModelState, modelStateSchema };