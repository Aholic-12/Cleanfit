import { DecartSDKError } from "../utils/errors.js";
import { DiagnosticEvent } from "./observability/diagnostics.js";
import { ConnectionState } from "./types.js";

//#region src/realtime/subscribe-client.d.ts

type SubscribeEvents = {
  connectionChange: ConnectionState;
  error: DecartSDKError;
  diagnostic: DiagnosticEvent;
};
type RealTimeSubscribeClient = {
  isConnected: () => boolean;
  getConnectionState: () => ConnectionState;
  disconnect: () => void;
  on: <K extends keyof SubscribeEvents>(event: K, listener: (data: SubscribeEvents[K]) => void) => void;
  off: <K extends keyof SubscribeEvents>(event: K, listener: (data: SubscribeEvents[K]) => void) => void;
};
/** The highest simulcast layer to receive; the SFU still drops lower when bandwidth requires. */
type SubscribeVideoQuality = "low" | "medium" | "high";
type SubscribeOptions = {
  token: string;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  /**
   * Also receive the session's input: the tracks its publisher sends into the
   * room (camera, microphone), as a separate MediaStream re-emitted whenever
   * its track set changes. Omit it and the input is never downloaded.
   */
  onInputStream?: (stream: MediaStream) => void;
  /** Highest quality of the input video to receive, when `onInputStream` is set. Default `"high"`. */
  inputVideoQuality?: SubscribeVideoQuality;
};
//#endregion
export { RealTimeSubscribeClient, SubscribeEvents, SubscribeOptions, SubscribeVideoQuality };