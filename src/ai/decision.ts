import type { RetryDecision } from "@/core/types";

const coerceDecision = (value: unknown): RetryDecision | null => {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.newTipLamports !== "number" || typeof v.reasoning !== "string") return null;

  // The model occasionally invents a "WAIT"/"HOLD" action, conflating it with the
  // waitForLeaderWindow flag. That intent is a retry-after-waiting, not an abort,
  // so honor it rather than discarding the decision.
  const raw = typeof v.action === "string" ? v.action.toUpperCase() : "";
  let action: RetryDecision["action"];
  let waitForLeaderWindow = v.waitForLeaderWindow === true;
  if (raw === "RETRY") action = "RETRY";
  else if (raw === "ABORT") action = "ABORT";
  else if (raw === "WAIT" || raw === "HOLD") {
    action = "RETRY";
    waitForLeaderWindow = true;
  } else return null;

  return {
    action,
    newTipLamports: v.newTipLamports,
    reasoning: v.reasoning,
    refreshBlockhash: v.refreshBlockhash === true,
    waitForLeaderWindow,
  };
};

export const parseDecision = (text: string): RetryDecision | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return coerceDecision(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
};
