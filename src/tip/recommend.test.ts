import { describe, expect, it } from "vitest";
import { clampTip, recommendBaseTip, JITO_MIN_TIP } from "./recommend";
import type { TipPercentiles } from "@/core/types";

const MAX = 1_000_000;

const tips: TipPercentiles = {
  p25: 1_000,
  p50: 10_000,
  p75: 50_000,
  p95: 200_000,
  p99: 500_000,
  emaLanded: 12_000,
  fetchedAt: 0,
};

describe("recommendBaseTip", () => {
  it("defaults to p75 in calm conditions", () => {
    expect(recommendBaseTip(tips, { skipRate: 0 }, MAX)).toBe(50_000);
  });

  it("honors the configured percentile", () => {
    expect(recommendBaseTip(tips, { skipRate: 0 }, MAX, "p50")).toBe(10_000);
  });

  it("scales up under congestion", () => {
    const calm = recommendBaseTip(tips, { skipRate: 0 }, MAX);
    const busy = recommendBaseTip(tips, { skipRate: 0.25 }, MAX);
    expect(busy).toBeGreaterThan(calm);
  });

  it("respects the hard ceiling", () => {
    expect(recommendBaseTip(tips, { skipRate: 1 }, 12_000)).toBe(12_000);
  });
});

describe("clampTip", () => {
  it("never goes below the Jito floor", () => {
    expect(clampTip(0, MAX)).toBe(JITO_MIN_TIP);
  });
});
