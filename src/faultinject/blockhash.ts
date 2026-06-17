import { connection } from "@/core/connection";
import { child } from "@/core/logger";

const log = child({ mod: "faultinject" });

export interface InjectedBlockhash {
  blockhash: string;
  lastValidBlockHeight: number;
}

export const forceExpiredBlockhash = async (
  slotsBack = 200,
): Promise<InjectedBlockhash> => {
  const [currentSlot, currentBlockHeight] = await Promise.all([
    connection.getSlot("confirmed"),
    connection.getBlockHeight("confirmed"),
  ]);
  const oldSlot = currentSlot - slotsBack;

  const block = await connection.getBlock(oldSlot, {
    maxSupportedTransactionVersion: 0,
    transactionDetails: "none",
    rewards: false,
  });

  if (!block)
    throw new Error(
      `could not fetch block at slot ${oldSlot} for fault injection`,
    );

  log.warn(
    { oldSlot, blockhash: block.blockhash },
    "injecting expired blockhash",
  );
  return {
    blockhash: block.blockhash,
    lastValidBlockHeight: currentBlockHeight - 50,
  };
};
