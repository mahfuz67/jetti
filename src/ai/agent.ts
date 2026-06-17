import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/config/env";
import { child } from "@/core/logger";
import { clampTip } from "@/tip/recommend";
import type { NetworkSnapshot, RetryDecision } from "@/core/types";

const log = child({ mod: "ai" });

const client = new Anthropic({ apiKey: config.ai.apiKey });

const SYSTEM = `You are the retry controller for a Solana Jito-bundle transaction stack.
A bundle just failed to land. Using the live snapshot you are given, decide what to do next.
You own this decision; nothing downstream second-guesses you.

Reason about the actual failure:
- EXPIRED_BLOCKHASH: the blockhash aged out before a Jito leader included the bundle. A refresh is mandatory; tip alone will not help.
- FEE_TOO_LOW: the tip was likely outbid. Raise the tip toward a higher percentile, but stay cost-aware.
- COMPUTE_EXCEEDED: a refresh/tip change will not fix this; abort.
- BUNDLE_FAILED / NOT_LANDED: weigh leader-window timing and tip competitiveness.

Network health: recentProcessedToConfirmedMs is the median processed→confirmed latency of recent attempts (null if none confirmed yet). A rising value means votes are propagating slowly — the cluster is stressed — so bias toward a higher tip and/or waiting for a clean leader window. A low, stable value means a healthy cluster where overpaying is wasteful.

Tip guidance: balance landing probability against cost. Do not exceed the hard ceiling.
Timing guidance: if no Jito leader window is open soon, prefer waiting over burning attempts.
Stop retrying when attempts are exhausted or the failure is not recoverable by retrying.

Respond with ONLY a JSON object, no prose, including ALL five fields every time (set booleans explicitly to false when not needed), matching exactly:
{"action":"RETRY"|"ABORT","refreshBlockhash":boolean,"newTipLamports":integer,"waitForLeaderWindow":boolean,"reasoning":"<one to three sentences explaining the decision>"}`;

// Lenient parse. The load-bearing fields are action, tip, and reasoning; the two
// booleans are defaulted if the model omits them (it occasionally does). A missing
// boolean degrades to a safe default rather than crashing the retry loop.
const coerceDecision = (value: unknown): RetryDecision | null => {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.action !== "RETRY" && v.action !== "ABORT") return null;
  if (typeof v.newTipLamports !== "number" || typeof v.reasoning !== "string") return null;
  return {
    action: v.action,
    newTipLamports: v.newTipLamports,
    reasoning: v.reasoning,
    refreshBlockhash: v.refreshBlockhash === true,
    waitForLeaderWindow: v.waitForLeaderWindow === true,
  };
};

const parseDecision = (text: string): RetryDecision | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return coerceDecision(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
};

export const decideRetry = async (snapshot: NetworkSnapshot): Promise<RetryDecision> => {
  const response = await client.messages.create({
    model: config.ai.model,
    max_tokens: 512,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Hard tip ceiling (lamports): ${config.tuning.maxTipLamports}\nSnapshot:\n${JSON.stringify(snapshot, null, 2)}`,
      },
    ],
  });

  const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");

  // Unparseable output is rare and unrecoverable for this attempt; abort retries
  // for this bundle rather than crashing the whole run (e.g. a batch in progress).
  const decision = parseDecision(text) ?? {
    action: "ABORT",
    refreshBlockhash: false,
    newTipLamports: snapshot.previousTipLamports,
    waitForLeaderWindow: false,
    reasoning: `unparseable model output, aborting retries: ${text.slice(0, 160)}`,
  };
  decision.newTipLamports = clampTip(decision.newTipLamports, config.tuning.maxTipLamports);

  log.info(
    { action: decision.action, tip: decision.newTipLamports, refresh: decision.refreshBlockhash },
    decision.reasoning,
  );
  return decision;
};
