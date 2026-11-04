//#region src/realtime/types.d.ts

type GenerationEndedMessage = GenerationEnded & {
  type: "generation_ended";
};
type QueuePositionMessage = {
  type: "queue_position";
  position: number;
  queue_size: number;
};
type QueuePosition = {
  position: number;
  queueSize: number;
};
type ConnectionState = "connecting" | "connected" | "generating" | "disconnected" | "reconnecting";
type GenerationTick = {
  seconds: number;
};
type GenerationEnded = {
  seconds: number;
  reason: string;
};
/**
 * Why the server ended a session on purpose. Terminal `generation_ended` reasons
 * (`moderation_violation`, `insufficient_credits`) pass through as sent; the SDK
 * derives the rest from the close:
 * - `policy_violation`: close 1008 before a reason was sent.
 * - `session_limit`: the API key's concurrent-session limit was reached (close 1013
 *   "Session Limit Reached"). Rejoin your own queue instead of dialling again.
 */
type SessionEndReason = "moderation_violation" | "insufficient_credits" | "policy_violation" | "session_limit" | (string & {});
/** The server ended the session on purpose; the SDK will not reconnect. */
type SessionEnded = {
  reason: SessionEndReason;
};
/**
 * The server refused a dial for lack of capacity and `connect()` is waiting `retryAfterMs` before
 * dialling again. `attempt` counts these waits within one `connect()`, from 1.
 */
type CapacityWait = {
  retryAfterMs: number;
  attempt: number;
};
type ImageSetOptions = {
  prompt?: string | null;
  enhance?: boolean;
  timeout?: number;
};
//#endregion
export { CapacityWait, ConnectionState, GenerationEnded, GenerationEndedMessage, GenerationTick, ImageSetOptions, QueuePosition, QueuePositionMessage, SessionEndReason, SessionEnded };