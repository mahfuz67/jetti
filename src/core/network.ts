import { connection } from "@/core/connection";
import { config } from "@/config/env";
import { fetchTipPercentiles } from "@/tip/tip-floor";
import { recommendBaseTip, type CongestionSignal } from "@/tip/recommend";
import type { Lamports, TipPercentiles } from "@/core/types";

const SLOTS_PER_SEC = 2.5;

export interface NetworkConditions {
  tips: TipPercentiles;
  congestion: CongestionSignal;
  baseTip: Lamports;
}

export const readCongestion = async (): Promise<CongestionSignal> => {
  const [sample] = await connection.getRecentPerformanceSamples(1);
  if (!sample || sample.samplePeriodSecs === 0) return { skipRate: 0 };
  const expectedSlots = sample.samplePeriodSecs * SLOTS_PER_SEC;
  const skipRate = Math.max(0, 1 - sample.numSlots / expectedSlots);
  return { skipRate };
};

export const readNetworkConditions = async (): Promise<NetworkConditions> => {
  const [tips, congestion] = await Promise.all([
    fetchTipPercentiles(),
    readCongestion(),
  ]);
  return {
    tips,
    congestion,
    baseTip: recommendBaseTip(tips, congestion, config.tuning.maxTipLamports),
  };
};
