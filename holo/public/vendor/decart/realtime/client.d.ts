import { CustomModelDefinition, ModelDefinition } from "../shared/model.js";
import { DecartSDKError } from "../utils/errors.js";
import { WebRTCStats } from "./observability/webrtc-stats.js";
import { ConnectionQualityReport } from "./observability/connection-quality.js";
import { DiagnosticEvent } from "./observability/diagnostics.js";
import { CapacityWait, ConnectionState, GenerationEnded, GenerationTick, ImageSetOptions, QueuePosition, SessionEnded } from "./types.js";
import { SetInput } from "./methods.js";
import { z } from "zod";

//#region src/realtime/client.d.ts

declare const realTimeClientInitialStateSchema: z.ZodObject<{
  prompt: z.ZodOptional<z.ZodObject<{
    text: z.ZodString;
    enhance: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
  }, z.core.$strip>>;
  image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodString]>>;
  passthrough: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
type OnRemoteStreamFn = (stream: MediaStream) => void;
type OnConnectionChangeFn = (state: ConnectionState) => void;
type OnConnectionQualityFn = (report: ConnectionQualityReport) => void;
type OnQueuePositionFn = (queuePosition: QueuePosition) => void;
type OnCapacityWaitFn = (wait: CapacityWait) => void;
type RealTimeClientInitialState = z.infer<typeof realTimeClientInitialStateSchema>;
declare const realTimeClientConnectOptionsSchema: z.ZodObject<{
  model: z.ZodObject<{
    name: z.ZodString;
    urlPath: z.ZodString;
    queueUrlPath: z.ZodOptional<z.ZodString>;
    fps: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
      max: z.ZodOptional<z.ZodNumber>;
      min: z.ZodOptional<z.ZodNumber>;
      ideal: z.ZodOptional<z.ZodNumber>;
      exact: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>]>;
    width: z.ZodNumber;
    height: z.ZodNumber;
    inputSchema: z.ZodOptional<z.ZodAny>;
    supportedSpeeds: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodEnum<{
      fast: "fast";
    }>>>>;
  }, z.core.$strip>;
  onRemoteStream: z.ZodCustom<OnRemoteStreamFn, OnRemoteStreamFn>;
  onConnectionChange: z.ZodOptional<z.ZodCustom<OnConnectionChangeFn, OnConnectionChangeFn>>;
  onConnectionQuality: z.ZodOptional<z.ZodCustom<OnConnectionQualityFn, OnConnectionQualityFn>>;
  onQueuePosition: z.ZodOptional<z.ZodCustom<OnQueuePositionFn, OnQueuePositionFn>>;
  onCapacityWait: z.ZodOptional<z.ZodCustom<OnCapacityWaitFn, OnCapacityWaitFn>>;
  initialState: z.ZodOptional<z.ZodObject<{
    prompt: z.ZodOptional<z.ZodObject<{
      text: z.ZodString;
      enhance: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>>;
    image: z.ZodOptional<z.ZodUnion<readonly [z.ZodType<Blob, unknown, z.core.$ZodTypeInternals<Blob, unknown>>, z.ZodType<File, unknown, z.core.$ZodTypeInternals<File, unknown>>, z.ZodString]>>;
    passthrough: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>>;
  queryParams: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  mirror: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"auto">, z.ZodBoolean]>>;
  resolution: z.ZodOptional<z.ZodEnum<{
    "720p": "720p";
    "1080p": "1080p";
  }>>;
  speed: z.ZodOptional<z.ZodEnum<{
    fast: "fast";
  }>>;
  retries: z.ZodOptional<z.ZodNumber>;
  capacityRetryBudgetMs: z.ZodOptional<z.ZodNumber>;
  preferredVideoCodec: z.ZodOptional<z.ZodEnum<{
    h264: "h264";
    vp8: "vp8";
    vp9: "vp9";
  }>>;
  debugQuality: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
type RealtimeMediaStream = {
  getTracks(): unknown[];
  getAudioTracks(): unknown[];
  getVideoTracks(): unknown[];
};
type RealTimeClientConnectOptions<TStream extends RealtimeMediaStream = MediaStream> = Omit<z.infer<typeof realTimeClientConnectOptionsSchema>, "model" | "onRemoteStream"> & {
  model: ModelDefinition | CustomModelDefinition;
  onRemoteStream: (stream: TStream) => void;
};
type Events = {
  connectionChange: ConnectionState;
  connectionQuality: ConnectionQualityReport;
  queuePosition: QueuePosition;
  error: DecartSDKError;
  generationTick: GenerationTick;
  generationEnded: GenerationEnded;
  /** Terminal: the server ended the session and no reconnect is coming. */
  sessionEnded: SessionEnded;
  diagnostic: DiagnosticEvent;
  stats: WebRTCStats;
};
type RealTimeClient = {
  set: (input: SetInput) => Promise<void>;
  setPrompt: (prompt: string, {
    enhance
  }?: {
    enhance?: boolean;
  }) => Promise<void>;
  isConnected: () => boolean;
  getConnectionState: () => ConnectionState;
  /** Latest interpreted connection-quality verdict, or null before any stats arrive. */
  getConnectionQuality: () => ConnectionQualityReport | null;
  disconnect: () => void;
  on: <K extends keyof Events>(event: K, listener: (data: Events[K]) => void) => void;
  off: <K extends keyof Events>(event: K, listener: (data: Events[K]) => void) => void;
  sessionId: string | null;
  subscribeToken: string | null;
  getSubscribeToken: () => string | null;
  /**
   * Set the reference image for the session.
   * - `Blob`/`File`/data URL/http(s) URL/base64 string: bytes traverse the wire as base64.
   * - `"file_..."` id (from `client.files.upload(...).id`): sent as a server-side reference.
   * - `null`: clear the current image.
   */
  setImage: (image: Blob | File | string | null, options?: ImageSetOptions) => Promise<void>;
  replaceVideoTrack: (track: MediaStreamTrack) => Promise<void>;
};
//#endregion
export { Events, RealTimeClient, RealTimeClientConnectOptions, RealTimeClientInitialState, RealtimeMediaStream };