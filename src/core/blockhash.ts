import type { JettiContext } from "@/context";

export interface CachedBlockhash {
  blockhash: string;
  lastValidBlockHeight: number;
}

const REFRESH_MS = 2_000;

const refresh = async (ctx: JettiContext): Promise<CachedBlockhash> => {
  const latest = await ctx.connection.getLatestBlockhash("confirmed");
  ctx.caches.blockhash.value = {
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
  return ctx.caches.blockhash.value;
};

const ensureRefresher = (ctx: JettiContext): void => {
  const cache = ctx.caches.blockhash;
  if (cache.timer) return;
  cache.timer = setInterval(() => void refresh(ctx).catch(() => {}), REFRESH_MS);
  cache.timer.unref?.();
};

export const getCachedBlockhash = async (
  ctx: JettiContext,
): Promise<CachedBlockhash> => {
  ensureRefresher(ctx);
  return ctx.caches.blockhash.value ?? refresh(ctx);
};

export const stopBlockhashRefresher = (ctx: JettiContext): void => {
  const cache = ctx.caches.blockhash;
  if (cache.timer) clearInterval(cache.timer);
  cache.timer = null;
};
