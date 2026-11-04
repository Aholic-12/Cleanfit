import { CustomModelDefinition, ModelDefinition } from "../shared/model.js";
import { ConnectionQuality } from "./observability/connection-quality.js";

//#region src/realtime/preflight-types.d.ts
type ConnectivityTransport = "udp" | "relay" | "failed";
type ConnectivityMetrics = {
  transport: ConnectivityTransport;
  rttMs: number | null;
  g2gMs?: number | null;
  ttffMs?: number | null;
  g2gDropRatio?: number | null;
  upstreamJitterMs?: number | null;
  packetLoss?: number | null;
  sampleCount?: number;
};
type ConnectivityReport = {
  quality: ConnectionQuality;
  metrics: ConnectivityMetrics;
  reasons: string[];
};
type CheckConnectivityOptions = {
  iceServers?: RTCIceServer[];
  iceGatherTimeoutMs?: number;
  signal?: AbortSignal;
  deep?: boolean;
  model?: ModelDefinition | CustomModelDefinition;
  durationMs?: number;
};
//#endregion
export { CheckConnectivityOptions, ConnectivityMetrics, ConnectivityReport, ConnectivityTransport };