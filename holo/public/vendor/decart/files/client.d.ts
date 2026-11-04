import { FileReference, FileUploadInput } from "./types.js";

//#region src/files/client.d.ts

type UploadFileOptions = {
  signal?: AbortSignal;
  /**
   * Expiration:
   * - omit → platform default (24 h)
   * - a positive integer → TTL in seconds (60 .. 2_592_000)
   * - `"persistent"` → never expires
   */
  ttlSeconds?: number | "persistent";
};
type FilesClient = {
  /**
   * Upload a file once and get a reusable reference. Pass `ref.id` to
   * realtime `set({ image })` to reuse the same asset across generations
   * without re-uploading.
   *
   * @example
   * ```ts
   * const ref = await client.files.upload(blob);
   * await rt.set({ image: ref.id, prompt: "make it cinematic" });
   * await rt.set({ image: ref.id, prompt: "now in noir" });   // reused, no re-upload
   * ```
   */
  upload: (file: FileUploadInput, options?: UploadFileOptions) => Promise<FileReference>;
  get: (fileId: string) => Promise<FileReference>;
  /**
   * Look up an upload by the MD5 of its bytes when you no longer have the id.
   * Resolves the newest non-expired match; rejects with `FILES_GET_ERROR` on
   * 404, exactly like `get` does for an unknown id.
   */
  getByMd5: (md5: string) => Promise<FileReference>;
  delete: (fileId: string) => Promise<void>;
};
//#endregion
export { FilesClient, UploadFileOptions };