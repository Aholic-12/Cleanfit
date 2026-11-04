//#region src/realtime/observability/diagnostics.d.ts
type ClientSessionConnectionBreakdownPhase = {
  phase: string;
  durationMs: number;
  success: boolean;
  error?: string;
};
type ClientSessionConnectionBreakdownEvent = {
  attempt: number;
  success: boolean;
  totalDurationMs: number;
  initialImageSizeKb: number | null;
  phases: ClientSessionConnectionBreakdownPhase[];
  error?: string;
};
type ReconnectEvent = {
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  success: boolean;
  error?: string;
};
type VideoStallEvent = {
  stalled: boolean;
  durationMs: number;
};
type DiagnosticEvents = {
  "client-session-connection-breakdown": ClientSessionConnectionBreakdownEvent;
  reconnect: ReconnectEvent;
  videoStall: VideoStallEvent;
};
type DiagnosticEventName = keyof DiagnosticEvents;
type DiagnosticEventForName<K extends DiagnosticEventName> = {
  name: K;
  data: DiagnosticEvents[K];
};
type DiagnosticEvent = { [K in DiagnosticEventName]: DiagnosticEventForName<K> }[DiagnosticEventName];
//#endregion
export { ClientSessionConnectionBreakdownEvent, ClientSessionConnectionBreakdownPhase, DiagnosticEvent, DiagnosticEventName, DiagnosticEvents, ReconnectEvent, VideoStallEvent };