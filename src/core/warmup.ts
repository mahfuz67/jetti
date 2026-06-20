import type { JettiContext } from "@/context";
import { child } from "@/core/logger";
import { getCachedBlockhash } from "@/core/blockhash";
import { getRandomTipAccount } from "@/bundle/tip-accounts";

const log = child({ mod: "warmup" });

const ANTHROPIC_HOST = "https://api.anthropic.com";

export const warmup = async (ctx: JettiContext): Promise<void> => {
  const started = Date.now();
  await Promise.allSettled([
    getCachedBlockhash(ctx),
    getRandomTipAccount(ctx),
    fetch(ANTHROPIC_HOST, { method: "GET" }).catch(() => undefined),
  ]);
  log.info(
    { ms: Date.now() - started, region: ctx.config.jito.region },
    "connections warmed",
  );
};
