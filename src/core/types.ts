export type Lamports = number;

export type LifecycleStage =
  | "submitted"
  | "processed"
  | "confirmed"
  | "finalized";

export interface StageRecord {
  stage: LifecycleStage;
  slot: number | null;
  at: number;
}

export const FAILURE_CLASSES = [
  "EXPIRED_BLOCKHASH",
  "FEE_TOO_LOW",
  "COMPUTE_EXCEEDED",
  "BUNDLE_FAILED",
  "NOT_LANDED",
  "UNKNOWN",
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

export interface FailureInfo {
  class: FailureClass;
  detail: string;
  raw?: unknown;
}

export interface TipPercentiles {
  p25: Lamports;
  p50: Lamports;
  p75: Lamports;
  p95: Lamports;
  p99: Lamports;
  emaLanded: Lamports;
  fetchedAt: number;
}

export interface NetworkSnapshot {
  failure: FailureInfo;
  currentSlot: number;
  lastValidBlockHeight: number;
  currentBlockHeight: number;
  blockhashAgeSlots: number;
  previousTipLamports: Lamports;
  tips: TipPercentiles;
  recentLandRate: number;
  // Median processed→confirmed latency (ms) over recent attempts — a live
  // consensus/vote-propagation health gauge. Null until we've confirmed one.
  recentProcessedToConfirmedMs: number | null;
  leaderWindowOpen: boolean;
  currentLeader: string | null;
  slotsRemainingInLeaderTurn: number;
  attempt: number;
  maxAttempts: number;
}

export interface RetryDecision {
  action: "RETRY" | "ABORT";
  refreshBlockhash: boolean;
  newTipLamports: Lamports;
  waitForLeaderWindow: boolean;
  reasoning: string;
}

export interface BundleAttempt {
  attempt: number;
  bundleId: string | null;
  tipLamports: Lamports;
  blockhash: string;
  lastValidBlockHeight: number;
  stages: StageRecord[];
  // Latency deltas (ms) between adjacent stages, filled at log-write time so the
  // persisted record carries them directly rather than requiring derivation.
  deltas?: Record<string, number>;
  failure: FailureInfo | null;
  decision: RetryDecision | null;
}

export interface BundleLifecycle {
  id: string;
  signature: string | null;
  region: string;
  attempts: BundleAttempt[];
  landed: boolean;
  landedSlot: number | null;
  startedAt: number;
  endedAt: number | null;
}
