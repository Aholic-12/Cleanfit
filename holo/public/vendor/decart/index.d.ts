import { CanonicalModel, CustomModelDefinition, ImageModelDefinition, ImageModels, ListedModelDefinition, Model, ModelDefinition, ModelFps, ModelKind, RealTimeModels, RealtimeSpeed, VideoModelDefinition, VideoModels, isCanonicalModel, isImageModel, isModel, isRealtimeModel, isVideoModel, listModels, modelAliases, models, resolveCanonicalModelAlias, resolveFpsNumber, resolveModelAlias } from "./shared/model.js";
import { FileInput, ProcessOptions, ReactNativeFile } from "./process/types.js";
import { FileReference, FileUploadInput } from "./files/types.js";
import { FilesClient, UploadFileOptions } from "./files/client.js";
import { ProcessClient } from "./process/client.js";
import { JobStatus, JobStatusResponse, JobSubmitResponse, QueueJobResult, QueueSubmitAndPollOptions, QueueSubmitOptions } from "./queue/types.js";
import { QueueClient } from "./queue/client.js";
import { DecartSDKError, ERROR_CODES } from "./utils/errors.js";
import { LogLevel, Logger, createConsoleLogger, noopLogger } from "./utils/logger.js";
import { ApiKeyProvider } from "./realtime/credential.js";
import { G2GMetrics } from "./realtime/observability/g2g.js";
import { WebRTCStats } from "./realtime/observability/webrtc-stats.js";
import { ConnectionQuality, ConnectionQualityLimitingFactor, ConnectionQualityMetrics, ConnectionQualityReport } from "./realtime/observability/connection-quality.js";
import { ClientSessionConnectionBreakdownEvent, ClientSessionConnectionBreakdownPhase, DiagnosticEvent, DiagnosticEventName, DiagnosticEvents, ReconnectEvent, VideoStallEvent } from "./realtime/observability/diagnostics.js";
import { CapacityWait, ConnectionState, GenerationEndedMessage, QueuePosition, QueuePositionMessage, SessionEndReason, SessionEnded } from "./realtime/types.js";
import { SetInput } from "./realtime/methods.js";
import { Events, RealTimeClient, RealTimeClientConnectOptions, RealTimeClientInitialState, RealtimeMediaStream } from "./realtime/client.js";
import { CheckConnectivityOptions, ConnectivityMetrics, ConnectivityReport, ConnectivityTransport } from "./realtime/preflight-types.js";
import { RealTimeSubscribeClient, SubscribeEvents, SubscribeOptions, SubscribeVideoQuality } from "./realtime/subscribe-client.js";
import { ModelState } from "./shared/types.js";
import { ClientTokenClaims, decodeClientToken } from "./tokens/claims.js";
import { VerifyClientTokenOptions, verifyClientToken } from "./tokens/verify.js";
import { CreateTokenOptions, CreateTokenResponse, TokensClient } from "./tokens/client.js";
import { DecartClientOptions } from "./create-client.js";

//#region src/index.d.ts
declare const createDecartClient: (options?: DecartClientOptions) => {
  realtime: {
    connect: <TStream extends RealtimeMediaStream = MediaStream>(stream: TStream | null, options: RealTimeClientConnectOptions<TStream>) => Promise<RealTimeClient>;
    subscribe: (options: SubscribeOptions) => Promise<RealTimeSubscribeClient>;
    checkConnectivity: (options?: CheckConnectivityOptions) => Promise<ConnectivityReport>;
  };
  process: ProcessClient;
  queue: QueueClient;
  tokens: TokensClient;
  files: FilesClient;
};
//#endregion
export { ApiKeyProvider, CanonicalModel, CapacityWait, CheckConnectivityOptions, ClientSessionConnectionBreakdownEvent, ClientSessionConnectionBreakdownPhase, ClientTokenClaims, ConnectionQuality, ConnectionQualityLimitingFactor, ConnectionQualityMetrics, ConnectionQualityReport, ConnectionState, ConnectivityMetrics, ConnectivityReport, ConnectivityTransport, CreateTokenOptions, CreateTokenResponse, CustomModelDefinition, type DecartClientOptions, DecartSDKError, DiagnosticEvent, DiagnosticEventName, DiagnosticEvents, ERROR_CODES, FileInput, FileReference, FileUploadInput, FilesClient, G2GMetrics, GenerationEndedMessage, ImageModelDefinition, ImageModels, JobStatus, JobStatusResponse, JobSubmitResponse, ListedModelDefinition, LogLevel, Logger, Model, ModelDefinition, ModelFps, ModelKind, ModelState, ProcessClient, ProcessOptions, QueueClient, QueueJobResult, QueuePosition, QueuePositionMessage, QueueSubmitAndPollOptions, QueueSubmitOptions, ReactNativeFile, RealTimeClient, RealTimeClientConnectOptions, RealTimeClientInitialState, Events as RealTimeEvents, RealTimeModels, RealTimeSubscribeClient, RealtimeMediaStream, RealtimeSpeed, ReconnectEvent, SessionEndReason, SessionEnded, SetInput, SubscribeEvents, SubscribeOptions, SubscribeVideoQuality, TokensClient, UploadFileOptions, VerifyClientTokenOptions, VideoModelDefinition, VideoModels, VideoStallEvent, WebRTCStats, createConsoleLogger, createDecartClient, decodeClientToken, isCanonicalModel, isImageModel, isModel, isRealtimeModel, isVideoModel, listModels, modelAliases, models, noopLogger, resolveCanonicalModelAlias, resolveFpsNumber, resolveModelAlias, verifyClientToken };