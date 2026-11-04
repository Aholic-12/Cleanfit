import { ImageModelDefinition } from "../shared/model.js";
import { ProcessOptions } from "./types.js";

//#region src/process/client.d.ts

/**
 * Client for synchronous image generation.
 * Only image models (t2i, i2i) support the sync/process API.
 */
type ProcessClient = <T extends ImageModelDefinition>(options: ProcessOptions<T>) => Promise<Blob>;
//#endregion
export { ProcessClient };