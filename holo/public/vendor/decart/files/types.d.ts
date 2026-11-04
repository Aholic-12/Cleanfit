import { ReactNativeFile } from "../process/types.js";

//#region src/files/types.d.ts

/**
 * Metadata for a previously-uploaded file. Returned by `client.files.upload(...)`.
 * Pass `ref.id` to `realtime.set({ image })` / `setImage(...)` to reuse it.
 *
 * Files expire after a server-configured TTL (default 24 h). `expires_at` is
 * `null` when the upload was created with `persistent: true`.
 */
interface FileReference {
  id: string;
  filename: string | null;
  /** Type of the stored file. The API re-encodes non-JPEG images to JPEG, so a PNG upload reports `image/jpeg`. */
  mime_type: string;
  size_bytes: number;
  /**
   * Lowercase hex MD5 of the uploaded bytes; pass it to `client.files.getByMd5(...)`
   * to find this file again without its id. `null` on files uploaded before
   * hashes were recorded.
   */
  md5: string | null;
  created_at: string;
  expires_at: string | null;
}
type FileUploadInput = File | Blob | ReactNativeFile;
//#endregion
export { FileReference, FileUploadInput };