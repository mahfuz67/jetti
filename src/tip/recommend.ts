import type { Lamports, TipPercentiles } from "@/core/types";

export const JITO_MIN_TIP: Lamports = 1_000;

export type TipPercentileKey = "p25" | "p50" | "p75" | "p95" | "p99";

export interface CongestionSignal {
  skipRate: number;
}

export const clampTip = (tip: Lamports, maxTip: Lamports): Lamports =>
  Math.max(JITO_MIN_TIP, Math.min(maxTip, Math.round(tip)));

export const recommendBaseTip = (
  tips: TipPercentiles,
  congestion: CongestionSignal,
  maxTip: Lamports,
  percentile: TipPercentileKey = "p75",
): Lamports => {
  const congestionFactor = 1 + Math.min(1, congestion.skipRate * 4);
  return clampTip(tips[percentile] * congestionFactor, maxTip);
};
