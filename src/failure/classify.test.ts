import { describe, expect, it } from "vitest";
import { classifyFailure, type ClassifyInput } from "./classify";
import type { TipPercentiles } from "@/core/types";

const tips: TipPercentiles = {
  p25: 1_000,
  p50: 10_000,
  p75: 50_000,
  p95: 200_000,
  p99: 500_000,
  emaLanded: 12_000,
  fetchedAt: 0,
};

const base: ClassifyInput = {
  landed: false,
  inflight: null,
  txErr: null,
  currentBlockHeight: 100,
  lastValidBlockHeight: 200,
  usedTipLamports: 50_000,
  tips,
};

describe("classifyFailure", () => {
  it("returns null when landed", () => {
    expect(classifyFailure({ ...base, landed: true })).toBeNull();
  });

  it("detects expired blockhash by block height", () => {
    expect(classifyFailure({ ...base, currentBlockHeight: 250 })?.class).toBe("EXPIRED_BLOCKHASH");
  });

  it("detects compute exceeded from tx error", () => {
    const err = { InstructionError: [0, "ComputeBudgetExceeded"] };
    expect(classifyFailure({ ...base, txErr: err })?.class).toBe("COMPUTE_EXCEEDED");
  });

  it("detects bundle failure from inflight status", () => {
    expect(classifyFailure({ ...base, inflight: "Failed" })?.class).toBe("BUNDLE_FAILED");
  });

  it("flags fee too low when tip below p50", () => {
    expect(classifyFailure({ ...base, usedTipLamports: 5_000 })?.class).toBe("FEE_TOO_LOW");
  });

  it("falls back to not landed", () => {
    expect(classifyFailure(base)?.class).toBe("NOT_LANDED");
  });
});
