//#region src/realtime/observability/connection-quality.d.ts
/**
 * Smoothed verdict on whether the connection is good enough for the realtime
 * pipeline, derived from the raw `WebRTCStats` the SDK already collects.
 *
 * Note: the bandwidth dimension relies on Chromium-only stats
 * (`availableOutgoingBitrate`), so on Safari/Firefox the verdict reflects
 * latency, loss, and fps only.
 */
type ConnectionQuality = "good" | "fair" | "poor" | "critical";
/** Which dimension pulled the verdict down to its current level. */
type ConnectionQualityLimitingFactor = "bandwidth" | "latency" | "loss" | "stall" | "cpu" | "none";
/** Human-meaningful numbers behind the verdict; the full raw stats are on the `stats` event. */
type ConnectionQualityMetrics = {
  /** Round-trip time in ms, or null until measured. */
  rttMs: number | null;
  /**
   * Mid-stream (steady-state) glass-to-glass latency (ms) — the real per-frame
   * camera→display latency through the model, excluding startup. Populated in
   * browser sessions when LiveKit frame metadata is available and past warm-up;
   * null otherwise. When present it drives the latency verdict instead of
   * `rttMs`.
   */
  g2gMs: number | null;
  /**
   * Time-to-first-frame (ms) — startup latency from connect to the first rendered
   * model frame. One-shot; populated under g2g measurement once the first frame
   * arrives. Surfaced for visibility; does not drive the live verdict (it's
   * historical by the time a verdict exists).
   */
  ttffMs: number | null;
  /** Rendered (inbound) frames per second, or null until measured. */
  fps: number | null;
  /** Fraction (0–1) of our outbound packets the server reports lost, or null until measured. */
  packetLoss: number | null;
  /** Server's view of upstream (client→server) jitter in ms, or null. Observational. */
  upstreamJitterMs: number | null;
  /**
   * End-to-end frame drop ratio (0–1). Null until frame identity is propagated
   * end-to-end; latency measurement itself only requires the capture timestamp.
   */
  g2gDropRatio: number | null;
  /** Estimated available upstream bandwidth in kbps. Chromium-only — null on Safari/Firefox. */
  availableUpstreamKbps: number | null;
};
type ConnectionQualityReport = {
  quality: ConnectionQuality;
  limitingFactor: ConnectionQualityLimitingFactor;
  /** True while the connection ramps; the verdict is provisional. */
  warmingUp: boolean;
  metrics: ConnectionQualityMetrics;
};
//#endregion
export { ConnectionQuality, ConnectionQualityLimitingFactor, ConnectionQualityMetrics, ConnectionQualityReport };