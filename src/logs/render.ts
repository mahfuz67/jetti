import type { BundleLifecycle } from "@/core/types";
import { stageDeltas } from "@/lifecycle/deltas";

export const renderLifecycle = (lc: BundleLifecycle): string => {
  const lines: string[] = [];
  lines.push(
    `bundle ${lc.id} [${lc.region}] landed=${lc.landed} signature=${lc.signature ?? "-"}`,
  );

  for (const a of lc.attempts) {
    const deltas = stageDeltas(a.stages);
    const stages = a.stages
      .map((s) => `${s.stage}@${s.slot ?? "-"}`)
      .join(" -> ");
    lines.push(
      `  attempt ${a.attempt}: tip=${a.tipLamports} bundleId=${a.bundleId ?? "-"}`,
    );
    lines.push(`    stages: ${stages}`);
    if (Object.keys(deltas).length > 0) {
      lines.push(`    deltas(ms): ${JSON.stringify(deltas)}`);
    }
    if (a.failure)
      lines.push(`    failure: ${a.failure.class} — ${a.failure.detail}`);
    if (a.decision) {
      lines.push(
        `    AI: ${a.decision.action} refresh=${a.decision.refreshBlockhash} newTip=${a.decision.newTipLamports}`,
      );
      lines.push(`    reasoning: ${a.decision.reasoning}`);
    }
  }
  return lines.join("\n");
};
