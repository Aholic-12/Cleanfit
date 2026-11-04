import { G2GMetrics } from "./g2g.js";

//#region src/realtime/observability/webrtc-stats.d.ts
type WebRTCStats = {
  timestamp: number;
  video: {
    framesDecoded: number;
    framesDropped: number;
    framesReceived: number;
    keyFramesDecoded: number;
    framesPerSecond: number;
    frameWidth: number;
    frameHeight: number;
    bytesReceived: number;
    packetsReceived: number;
    packetsLost: number;
    jitter: number;
    /** Estimated inbound bitrate in bits/sec, computed from bytesReceived delta. */
    bitrate: number;
    freezeCount: number;
    totalFreezesDuration: number;
    /** Delta: packets lost since previous sample. */
    packetsLostDelta: number;
    /** Delta: frames dropped since previous sample. */
    framesDroppedDelta: number;
    /** Delta: freeze count since previous sample. */
    freezeCountDelta: number;
    /** Delta: freeze duration (seconds) since previous sample. */
    freezeDurationDelta: number;
    /** NACKs sent to the sender (requesting packet retransmission). */
    nackCount: number;
    nackCountDelta: number;
    /** PLIs sent to the sender (full frame retransmission request). */
    pliCount: number;
    /** FIRs sent to the sender (forced intra-refresh request). */
    firCount: number;
    /**
     * Average decode time (ms/frame), cumulative since stream start.
     * Derived from totalDecodeTime/framesDecoded. `null` if the browser
     * hasn't produced the underlying counters yet.
     */
    avgDecodeTimeMs: number | null;
    /** Average jitter-buffer time (ms/frame emitted). Cumulative. */
    avgJitterBufferMs: number | null;
    /**
     * Average total processing delay (ms/frame decoded) — from network
     * receive to decoder output. Cumulative.
     */
    avgProcessingDelayMs: number | null;
    /** Average inter-frame delay at the decoder (ms). */
    avgInterFrameDelayMs: number | null;
    /**
     * Std-dev of inter-frame delay (ms), computed from
     * totalInterFrameDelay + totalSquaredInterFrameDelay.
     */
    interFrameDelayStdDevMs: number | null;
    /** Current target delay of the jitter buffer (ms). */
    jitterBufferTargetDelayMs: number | null;
    /** Current minimum delay of the jitter buffer (ms). */
    jitterBufferMinimumDelayMs: number | null;
    /** Which decoder the browser picked (e.g. "libvpx", "ExternalDecoder"). */
    decoderImplementation: string;
  } | null;
  audio: {
    bytesReceived: number;
    packetsReceived: number;
    packetsLost: number;
    jitter: number;
    /** Estimated inbound bitrate in bits/sec, computed from bytesReceived delta. */
    bitrate: number;
    /** Delta: packets lost since previous sample. */
    packetsLostDelta: number;
  } | null;
  /** Outbound video track stats (from the local camera/screen share being sent). */
  outboundVideo: {
    /** Why the encoder is limiting quality: "none", "bandwidth", "cpu", or "other". */
    qualityLimitationReason: string;
    /** Cumulative time (seconds) spent in each quality limitation state. */
    qualityLimitationDurations: Record<string, number>;
    bytesSent: number;
    packetsSent: number;
    framesPerSecond: number;
    frameWidth: number;
    frameHeight: number;
    /** Estimated outbound bitrate in bits/sec, computed from bytesSent delta. */
    bitrate: number;
    /** Encoder's current target bitrate in kbps (BWE output). */
    targetBitrateKbps: number | null;
    /** Average encode time per frame (ms), cumulative. */
    avgEncodeTimeMs: number | null;
    /** Average packet send delay (ms), cumulative. */
    avgPacketSendDelayMs: number | null;
    /** Average quantization parameter across encoded frames (lower is better). */
    avgQp: number | null;
    /** NACKs received from receiver (retransmission requests). */
    nackCount: number;
    /** PLIs received from receiver. */
    pliCount: number;
    /** FIRs received from receiver. */
    firCount: number;
    retransmittedBytesSent: number;
    retransmittedPacketsSent: number;
    /** Which encoder the browser picked (e.g. "libvpx", "SimulcastEncoderAdapter"). */
    encoderImplementation: string;
  } | null;
  /**
   * Remote-inbound stats — what the far end reports *about its reception
   * of our outbound stream*. Answers "does the server think we're lossy?"
   * independently of what we see locally. Populated from
   * `remote-inbound-rtp` reports.
   */
  remoteInbound: {
    fractionLost: number | null;
    /** In seconds. */
    jitter: number | null;
    /** In seconds. Often more accurate than connection.currentRoundTripTime. */
    roundTripTime: number | null;
  } | null;
  connection: {
    /** Current round-trip time in seconds, or null if unavailable. */
    currentRoundTripTime: number | null;
    /** Available outgoing bitrate estimate in bits/sec, or null if unavailable. */
    availableOutgoingBitrate: number | null;
    /**
     * Selected ICE candidate pairs (usually one per PC). Populated from
     * the `candidate-pair` report with state="succeeded" plus the matching
     * `local-candidate` / `remote-candidate` lookups. Lets diagnostic tools
     * tell direct-UDP sessions from TURN-relayed ones — the path affects
     * jitter and failure modes, so this is essential signal for
     * benchmarking and incident triage.
     */
    selectedCandidatePairs: IceCandidatePair[];
  };
  /**
   * True glass-to-glass latency + end-to-end drop signal, merged in by
   * `RealtimeObservability` when frame-metadata measurement is active. Null
   * otherwise — the stats collector does not populate it.
   */
  glassToGlass: G2GMetrics | null;
};
/** One side of an ICE candidate pair (sender or receiver). */
type IceCandidateInfo = {
  /** "host" | "srflx" | "prflx" | "relay" */
  candidateType: string;
  /** IP (v4 or v6). May be `""` for mDNS-obfuscated host candidates. */
  address: string;
  port: number;
  /** "udp" | "tcp" */
  protocol: string;
};
type IceCandidatePair = {
  local: IceCandidateInfo;
  remote: IceCandidateInfo;
};
//#endregion
export { IceCandidateInfo, IceCandidatePair, WebRTCStats };