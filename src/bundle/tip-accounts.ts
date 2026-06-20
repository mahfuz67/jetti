import { PublicKey } from "@solana/web3.js";
import type { JettiContext } from "@/context";
import { getTipAccounts } from "./jito-client";

const TTL_MS = 60 * 60 * 1000;

export const getRandomTipAccount = async (
  ctx: JettiContext,
): Promise<PublicKey> => {
  const cache = ctx.caches.tipAccounts;
  if (!cache.value || Date.now() - cache.at > TTL_MS) {
    const accounts = (await getTipAccounts(ctx)).map((a) => new PublicKey(a));
    if (accounts.length === 0)
      throw new Error("getTipAccounts returned empty list");
    cache.value = accounts;
    cache.at = Date.now();
  }
  const accounts = cache.value;
  return accounts[Math.floor(Math.random() * accounts.length)]!;
};
