import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { JettiContext } from "@/context";
import type { Lamports } from "@/core/types";
import { getRandomTipAccount } from "./tip-accounts";

// A self-transfer probe (the bounty harness), caller-supplied instructions, or a
// fully prebuilt transaction. The tip is always a separate transaction in the
// bundle, so a real caller transaction is never modified.
export type BundlePayload =
  | { kind: "probe" }
  | {
      kind: "instructions";
      instructions: TransactionInstruction[];
      signers: Signer[];
      feePayer?: PublicKey;
    }
  | { kind: "transaction"; transaction: VersionedTransaction; lastValidBlockHeight?: number };

export interface BuildParams {
  blockhash: string;
  lastValidBlockHeight: number;
  tipLamports: Lamports;
}

export interface BuiltBundle {
  base64Txs: string[];
  signature: string;
  tipAccount: string;
  tipLamports: Lamports;
  blockhash: string;
  lastValidBlockHeight: number;
}

const serialize = (tx: VersionedTransaction): string =>
  Buffer.from(tx.serialize()).toString("base64");

const signatureOf = (tx: VersionedTransaction): string => {
  const sig = tx.signatures[0];
  if (!sig) throw new Error("transaction is unsigned");
  return bs58.encode(sig);
};

const signMessage = (
  instructions: TransactionInstruction[],
  payerKey: PublicKey,
  blockhash: string,
  signers: Signer[],
): VersionedTransaction => {
  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign(signers);
  return tx;
};

const probeInstructions = (ctx: JettiContext): TransactionInstruction[] => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000 }),
  SystemProgram.transfer({
    fromPubkey: ctx.config.wallet.publicKey,
    toPubkey: ctx.config.wallet.publicKey,
    lamports: ctx.config.tuning.probeTransferLamports,
  }),
];

export interface UserTransaction {
  tx: VersionedTransaction;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

export const buildUserTransaction = (
  ctx: JettiContext,
  payload: BundlePayload,
  params: BuildParams,
): UserTransaction => {
  if (payload.kind === "transaction") {
    const tx = payload.transaction;
    return {
      tx,
      signature: signatureOf(tx),
      blockhash: tx.message.recentBlockhash,
      lastValidBlockHeight:
        payload.lastValidBlockHeight ?? params.lastValidBlockHeight,
    };
  }

  const wallet = ctx.config.wallet;
  const feePayer =
    payload.kind === "instructions"
      ? (payload.feePayer ?? wallet.publicKey)
      : wallet.publicKey;
  const instructions =
    payload.kind === "instructions"
      ? payload.instructions
      : probeInstructions(ctx);
  const baseSigners =
    payload.kind === "instructions" ? payload.signers : [wallet];
  // The fee payer must sign; include the configured wallet when it is the payer.
  const signers =
    feePayer.equals(wallet.publicKey) &&
    !baseSigners.some((s) => s.publicKey.equals(wallet.publicKey))
      ? [...baseSigners, wallet]
      : baseSigners;

  const tx = signMessage(instructions, feePayer, params.blockhash, signers);
  return {
    tx,
    signature: signatureOf(tx),
    blockhash: params.blockhash,
    lastValidBlockHeight: params.lastValidBlockHeight,
  };
};

// Pure assembly: user transaction + a separate tip transaction, given a tip
// account. Network-free so it can be unit-tested.
export const assembleBundle = (
  ctx: JettiContext,
  payload: BundlePayload,
  params: BuildParams,
  tipAccount: PublicKey,
): BuiltBundle => {
  const user = buildUserTransaction(ctx, payload, params);
  const tipTx = signMessage(
    [
      SystemProgram.transfer({
        fromPubkey: ctx.config.wallet.publicKey,
        toPubkey: tipAccount,
        lamports: params.tipLamports,
      }),
    ],
    ctx.config.wallet.publicKey,
    params.blockhash,
    [ctx.config.wallet],
  );

  return {
    base64Txs: [serialize(user.tx), serialize(tipTx)],
    signature: user.signature,
    tipAccount: tipAccount.toBase58(),
    tipLamports: params.tipLamports,
    blockhash: user.blockhash,
    lastValidBlockHeight: user.lastValidBlockHeight,
  };
};

export const buildBundle = async (
  ctx: JettiContext,
  payload: BundlePayload,
  params: BuildParams,
): Promise<BuiltBundle> => {
  const tipAccount = await getRandomTipAccount(ctx);
  return assembleBundle(ctx, payload, params, tipAccount);
};
