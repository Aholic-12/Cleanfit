import { ERROR_CODES } from "./utils/errors.js";
import { decodeClientToken } from "./tokens/claims.js";
import { verifyClientToken } from "./tokens/verify.js";
import { createConsoleLogger, noopLogger } from "./utils/logger.js";
import { createDecartClientForPlatform } from "./create-client.js";
import { isCanonicalModel, isImageModel, isModel, isRealtimeModel, isVideoModel, listModels, modelAliases, models, resolveCanonicalModelAlias, resolveFpsNumber, resolveModelAlias } from "./shared/model.js";
import { createBrowserRealtime } from "./realtime/browser/index.js";
//#region src/index.ts
const createDecartClient = (options = {}) => createDecartClientForPlatform(createBrowserRealtime, options);
//#endregion
export { ERROR_CODES, createConsoleLogger, createDecartClient, decodeClientToken, isCanonicalModel, isImageModel, isModel, isRealtimeModel, isVideoModel, listModels, modelAliases, models, noopLogger, resolveCanonicalModelAlias, resolveFpsNumber, resolveModelAlias, verifyClientToken };
