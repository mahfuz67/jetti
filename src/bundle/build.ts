import {
  ComputeBudgetProgram,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "@/config/env";
import type { Lamports } from "@/core/types";
import { getRandomTipAccount } from "./tip-accounts";

export interface BuiltBundle {
  base64Txs: string[];
  signature: string;
  tipAccount: string;
  tipLamports: Lamports;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface BuildParams {
  blockhash: string;
  lastValidBlockHeight: number;
  tipLamports: Lamports;
}

export const buildProbeBundle = async (
  params: BuildParams,
): Promise<BuiltBundle> => {
  const payer = config.wallet;
  const tipAccount = await getRandomTipAccount();

  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000 }),
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: config.tuning.probeTransferLamports,
    }),
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: tipAccount,
      lamports: params.tipLamports,
    }),
  ];

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: params.blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  const signature = bs58FromSignature(tx);

  return {
    base64Txs: [Buffer.from(tx.serialize()).toString("base64")],
    signature,
    tipAccount: tipAccount.toBase58(),
    tipLamports: params.tipLamports,
    blockhash: params.blockhash,
    lastValidBlockHeight: params.lastValidBlockHeight,
  };
};

const bs58FromSignature = (tx: VersionedTransaction): string => {
  const sig = tx.signatures[0];
  if (!sig) throw new Error("transaction is unsigned");
  return bs58.encode(sig);
};
