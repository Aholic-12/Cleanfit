import { z } from "zod";

//#region src/realtime/methods.d.ts
declare const setInputSchema: z.ZodObject<{
  prompt: z.ZodOptional<z.ZodString>;
  enhance: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
  image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodString, z.ZodNull]>>;
}, z.core.$strip>;
type SetInput = z.input<typeof setInputSchema>;
//#endregion
export { SetInput };