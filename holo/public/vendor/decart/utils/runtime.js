import { z } from "zod";
//#region src/utils/runtime.ts
/** Safely test a platform-provided constructor without evaluating a missing global. */
function isGlobalInstance(value, name) {
	const runtimeConstructor = globalThis[name];
	return typeof runtimeConstructor === "function" && value instanceof runtimeConstructor;
}
/** Zod schema for values whose constructor may not exist in every runtime. */
function globalInstanceSchema(name) {
	return z.custom((value) => isGlobalInstance(value, name), { message: `Expected ${name}` });
}
//#endregion
export { globalInstanceSchema, isGlobalInstance };
