import type {
  BundleLifecycle,
  FailureInfo,
  Lamports,
  RetryDecision,
} from "@/core/types";
import type { BundlePayload } from "@/bundle/build";

export type JettiEvent =
  | { type: "submitted"; attempt: number; bundleId: string | null; tipLamports: Lamports }
  | { type: "processed"; slot: number; at: number }
  | { type: "confirmed"; slot: number; at: number }
  | { type: "finalized"; slot: number; at: number }
  | { type: "failure"; attempt: number; failure: FailureInfo }
  | { type: "decision"; attempt: number; decision: RetryDecision }
  | { type: "landed"; slot: number | null; signature: string | null }
  | { type: "aborted"; attempt: number; reason: string }
  | { type: "complete"; lifecycle: BundleLifecycle };

export interface SendRequest {
  payload: BundlePayload;
  maxAttempts?: number;
  injectExpiry?: boolean;
  trackTimeoutMs?: number;
  onEvent?: (event: JettiEvent) => void;
}
