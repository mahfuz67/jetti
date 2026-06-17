import type {
  FailureClass,
  FailureInfo,
  Lamports,
  TipPercentiles,
} from "@/core/types";
import type { InflightStatus } from "@/bundle/jito-client";

export interface ClassifyInput {
  landed: boolean;
  inflight: InflightStatus["status"] | null;
  txErr: unknown;
  currentBlockHeight: number;
  lastValidBlockHeight: number;
  usedTipLamports: Lamports;
  tips: TipPercentiles;
}

const has = (value: unknown, needle: string): boolean =>
  JSON.stringify(value ?? "")
    .toLowerCase()
    .includes(needle.toLowerCase());

const make = (cls: FailureClass, detail: string, raw?: unknown): FailureInfo =>
  raw === undefined ? { class: cls, detail } : { class: cls, detail, raw };

export const classifyFailure = (input: ClassifyInput): FailureInfo | null => {
  if (input.landed) return null;

  if (input.currentBlockHeight > input.lastValidBlockHeight) {
    return make(
      "EXPIRED_BLOCKHASH",
      `blockhash expired: currentBlockHeight ${input.currentBlockHeight} > lastValid ${input.lastValidBlockHeight}`,
    );
  }

  if (has(input.txErr, "BlockhashNotFound") || has(input.txErr, "blockhash")) {
    return make(
      "EXPIRED_BLOCKHASH",
      "node reported blockhash not found",
      input.txErr,
    );
  }

  if (
    has(input.txErr, "ComputeBudgetExceeded") ||
    has(input.txErr, "exceeded CUs")
  ) {
    return make("COMPUTE_EXCEEDED", "compute unit limit exceeded", input.txErr);
  }

  if (input.inflight === "Failed" || input.inflight === "Invalid") {
    return make(
      "BUNDLE_FAILED",
      `bundle engine status: ${input.inflight}`,
      input.txErr,
    );
  }

  if (input.usedTipLamports < input.tips.p50) {
    return make(
      "FEE_TOO_LOW",
      `tip ${input.usedTipLamports} below p50 ${input.tips.p50}; likely outbid`,
    );
  }

  return make(
    "NOT_LANDED",
    "no landing observed within validity window",
    input.txErr,
  );
};
