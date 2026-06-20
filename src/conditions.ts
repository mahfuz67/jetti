import type { JettiContext } from "@/context";
import { fetchTipPercentiles } from "@/tip/tip-floor";
import { recommendBaseTip, type CongestionSignal } from "@/tip/recommend";
import type { Lamports, TipPercentiles } from "@/core/types";

const SLOTS_PER_SEC = 2.5;
const CONGESTION_TTL_MS = 10_000;

export interface NetworkConditions {
  tips: TipPercentiles;
  congestion: CongestionSignal;
  baseTip: Lamports;
}

export const readCongestion = async (
  ctx: JettiContext,
): Promise<CongestionSignal> => {
  const cache = ctx.caches.congestion;
  if (cache.value && Date.now() - cache.at < CONGESTION_TTL_MS)
    return cache.value;

  const [sample] = await ctx.connection.getRecentPerformanceSamples(1);
  const value: CongestionSignal =
    !sample || sample.samplePeriodSecs === 0
      ? { skipRate: 0 }
      : {
          skipRate: Math.max(
            0,
            1 - sample.numSlots / (sample.samplePeriodSecs * SLOTS_PER_SEC),
          ),
        };

  cache.value = value;
  cache.at = Date.now();
  return value;
};

export const readNetworkConditions = async (
  ctx: JettiContext,
): Promise<NetworkConditions> => {
  const [tips, congestion] = await Promise.all([
    fetchTipPercentiles(ctx),
    readCongestion(ctx),
  ]);
  return {
    tips,
    congestion,
    baseTip: recommendBaseTip(
      tips,
      congestion,
      ctx.config.tuning.maxTipLamports,
      ctx.config.tuning.baseTipPercentile,
    ),
  };
};
