//#region src/utils/env.ts
const readEnv = (env) => {
	const globalThisAny = globalThis;
	if (typeof globalThisAny.process !== "undefined") return globalThisAny.process.env?.[env]?.trim();
	if (typeof globalThisAny.Deno !== "undefined") return globalThisAny.Deno.env?.get?.(env)?.trim();
};
//#endregion
export { readEnv };
