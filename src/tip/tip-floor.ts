import type { JettiContext } from "@/context";
import type { TipPercentiles } from "@/core/types";

const LAMPORTS_PER_SOL = 1_000_000_000;

interface TipFloorRow {
  landed_tips_25th_percentile: number;
  landed_tips_50th_percentile: number;
  landed_tips_75th_percentile: number;
  landed_tips_95th_percentile: number;
  landed_tips_99th_percentile: number;
  ema_landed_tips_50th_percentile: number;
}

const toLamports = (sol: number): number => Math.round(sol * LAMPORTS_PER_SOL);

const TTL_MS = 1_500;

export const fetchTipPercentiles = async (
  ctx: JettiContext,
): Promise<TipPercentiles> => {
  const cache = ctx.caches.tipFloor;
  if (cache.value && Date.now() - cache.value.fetchedAt < TTL_MS)
    return cache.value;

  const res = await fetch(ctx.config.jito.tipFloorUrl);
  if (!res.ok) throw new Error(`tip_floor HTTP ${res.status}`);

  const rows = (await res.json()) as TipFloorRow[];
  const row = rows[0];
  if (!row) throw new Error("tip_floor returned no rows");

  cache.value = {
    p25: toLamports(row.landed_tips_25th_percentile),
    p50: toLamports(row.landed_tips_50th_percentile),
    p75: toLamports(row.landed_tips_75th_percentile),
    p95: toLamports(row.landed_tips_95th_percentile),
    p99: toLamports(row.landed_tips_99th_percentile),
    emaLanded: toLamports(row.ema_landed_tips_50th_percentile),
    fetchedAt: Date.now(),
  };
  return cache.value;
};
