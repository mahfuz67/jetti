import type { JettiContext } from "@/context";
import { getCachedBlockhash } from "@/core/blockhash";
import { readNetworkConditions } from "@/conditions";
import { buildUserTransaction, type BundlePayload } from "@/bundle/build";

export interface SimulateResult {
  success: boolean;
  err: unknown;
  logs: string[] | null;
  unitsConsumed: number | null;
  signature: string;
}

export const simulateBundle = async (
  ctx: JettiContext,
  payload: BundlePayload,
): Promise<SimulateResult> => {
  const [bh, conditions] = await Promise.all([
    getCachedBlockhash(ctx),
    readNetworkConditions(ctx),
  ]);
  const user = buildUserTransaction(ctx, payload, {
    blockhash: bh.blockhash,
    lastValidBlockHeight: bh.lastValidBlockHeight,
    tipLamports: conditions.baseTip,
  });

  const sim = await ctx.connection.simulateTransaction(user.tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });

  return {
    success: sim.value.err === null,
    err: sim.value.err,
    logs: sim.value.logs,
    unitsConsumed: sim.value.unitsConsumed ?? null,
    signature: user.signature,
  };
};
