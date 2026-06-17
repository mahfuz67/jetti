import { PublicKey } from "@solana/web3.js";
import { getTipAccounts } from "./jito-client";

let cache: { accounts: PublicKey[]; at: number } | null = null;
const TTL_MS = 60 * 60 * 1000;

export const getRandomTipAccount = async (): Promise<PublicKey> => {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const accounts = (await getTipAccounts()).map((a) => new PublicKey(a));
    if (accounts.length === 0)
      throw new Error("getTipAccounts returned empty list");
    cache = { accounts, at: Date.now() };
  }
  const accounts = cache.accounts;
  return accounts[Math.floor(Math.random() * accounts.length)]!;
};
