//#region src/files/types.ts
/** Prefix on every uploaded-file id; disambiguates a ref string from base64. */
const FILE_REF_PREFIX = "file_";
/** True if `value` is a `"file_..."` reference id from `client.files.upload(...)`. */
const isFileRefId = (value) => typeof value === "string" && value.startsWith("file_");
//#endregion
export { FILE_REF_PREFIX, isFileRefId };
