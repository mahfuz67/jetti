import type { JettiContext } from "@/context";
import { child } from "@/core/logger";
import { clampTip } from "@/tip/recommend";
import { parseDecision } from "@/ai/decision";
import type { NetworkSnapshot, RetryDecision } from "@/core/types";

const log = child({ mod: "ai" });

const SYSTEM = `You are the retry controller for a Solana Jito-bundle transaction stack.
A bundle just failed to land. Using the live snapshot you are given, decide what to do next.
You own this decision; nothing downstream second-guesses you.

Reason about the actual failure:
- EXPIRED_BLOCKHASH: the blockhash aged out before a Jito leader included the bundle. A refresh is mandatory; tip alone will not help.
- FEE_TOO_LOW: the tip was likely outbid. Raise the tip toward a higher percentile, but stay cost-aware.
- COMPUTE_EXCEEDED: a refresh/tip change will not fix this; abort.
- BUNDLE_FAILED / NOT_LANDED: the bundle was NOT included — it was outbid or dropped in the auction. This is NOT a malformed or invalid transaction (a malformed tx is rejected at submission and never gets a bundle id; yours did). The Jito status "Invalid" here means "not landed", not "bad transaction". Treat it as losing the auction at that tip. Contested slots clear near the p99 tip, NOT p95 — so p95 alone often is not enough in a sharp spike. Escalate aggressively: bid toward p95 first, then toward p99, and up to the hard ceiling if it keeps failing. Never bid below the previous failed tip.

Network health: recentProcessedToConfirmedMs is the median processed→confirmed latency of recent attempts (null if none confirmed yet). A rising value means votes are propagating slowly — the cluster is stressed — so bias toward a higher tip and/or waiting for a clean leader window. A low, stable value means a healthy cluster where overpaying is wasteful.

Tip guidance: balance landing probability against cost, but on a retry after a failure NEVER set newTipLamports below the previous attempt's tip — you already lost at that price, so go higher. When the tip floor p95 is high (a fee spike), bid up toward p95, using the full ceiling if needed; landing matters more than shaving lamports. Do not exceed the hard ceiling.
Timing guidance: if no Jito leader window is open soon, return action RETRY with waitForLeaderWindow=true. There is NO "WAIT" or "HOLD" action — action is ONLY "RETRY" or "ABORT".
Stop retrying when attempts are exhausted or the failure is not recoverable by retrying.

Respond with ONLY a JSON object, no prose, including ALL five fields every time (set booleans explicitly to false when not needed), matching exactly:
{"action":"RETRY"|"ABORT","refreshBlockhash":boolean,"newTipLamports":integer,"waitForLeaderWindow":boolean,"reasoning":"<one or two sentences: name the failure, its likely cause, and why this tip / refresh / timing choice>"}
The reasoning is logged verbatim and judged, so make it substantive but concise — no filler.`;

export const decideRetry = async (
  ctx: JettiContext,
  snapshot: NetworkSnapshot,
): Promise<RetryDecision> => {
  const response = await ctx.ai.messages.create({
    model: ctx.config.ai.model,
    max_tokens: 256,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Hard tip ceiling (lamports): ${ctx.config.tuning.maxTipLamports}\nSnapshot:\n${JSON.stringify(snapshot, null, 2)}`,
      },
      { role: "assistant", content: "{" },
    ],
  });

  const text =
    "{" +
    response.content.map((block) => (block.type === "text" ? block.text : "")).join("");

  // Unparseable output is rare and unrecoverable for this attempt; abort retries
  // for this bundle rather than crashing the whole run (e.g. a batch in progress).
  const decision = parseDecision(text) ?? {
    action: "ABORT",
    refreshBlockhash: false,
    newTipLamports: snapshot.previousTipLamports,
    waitForLeaderWindow: false,
    reasoning: `unparseable model output, aborting retries: ${text.slice(0, 160)}`,
  };
  decision.newTipLamports = clampTip(
    decision.newTipLamports,
    ctx.config.tuning.maxTipLamports,
  );

  log.info(
    { action: decision.action, tip: decision.newTipLamports, refresh: decision.refreshBlockhash },
    decision.reasoning,
  );
  return decision;
};
