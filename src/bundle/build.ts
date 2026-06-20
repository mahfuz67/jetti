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
// fully prebuilt transaction.
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

const tipInstruction = (
  ctx: JettiContext,
  tipAccount: PublicKey,
  lamports: Lamports,
): TransactionInstruction =>
  SystemProgram.transfer({
    fromPubkey: ctx.config.wallet.publicKey,
    toPubkey: tipAccount,
    lamports,
  });

// Resolve instructions / fee payer / signers for a payload we build ourselves
// (probe or caller-supplied instructions).
const resolveBuildable = (
  ctx: JettiContext,
  payload: Extract<BundlePayload, { kind: "probe" | "instructions" }>,
): { instructions: TransactionInstruction[]; feePayer: PublicKey; signers: Signer[] } => {
  const wallet = ctx.config.wallet;
  const feePayer =
    payload.kind === "instructions"
      ? (payload.feePayer ?? wallet.publicKey)
      : wallet.publicKey;
  const instructions =
    payload.kind === "instructions" ? payload.instructions : probeInstructions(ctx);
  const baseSigners = payload.kind === "instructions" ? payload.signers : [wallet];
  // The fee payer must sign; include the configured wallet when it is the payer.
  const signers =
    feePayer.equals(wallet.publicKey) &&
    !baseSigners.some((s) => s.publicKey.equals(wallet.publicKey))
      ? [...baseSigners, wallet]
      : baseSigners;
  return { instructions, feePayer, signers };
};

const withWalletSigner = (ctx: JettiContext, signers: Signer[]): Signer[] =>
  signers.some((s) => s.publicKey.equals(ctx.config.wallet.publicKey))
    ? signers
    : [...signers, ctx.config.wallet];

export interface UserTransaction {
  tx: VersionedTransaction;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

// The caller transaction without a tip — used by simulate (cost-free dry run).
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
  const { instructions, feePayer, signers } = resolveBuildable(ctx, payload);
  const tx = signMessage(instructions, feePayer, params.blockhash, signers);
  return {
    tx,
    signature: signatureOf(tx),
    blockhash: params.blockhash,
    lastValidBlockHeight: params.lastValidBlockHeight,
  };
};

// Assemble the bundle. For payloads we build (probe / instructions) the tip is
// the last instruction of a single transaction — the cheapest, highest-landing
// shape. A prebuilt transaction can't be modified, so its tip rides in a
// separate transaction, leaving the caller's transaction untouched.
export const assembleBundle = (
  ctx: JettiContext,
  payload: BundlePayload,
  params: BuildParams,
  tipAccount: PublicKey,
): BuiltBundle => {
  const tipIx = tipInstruction(ctx, tipAccount, params.tipLamports);
  const meta = {
    tipAccount: tipAccount.toBase58(),
    tipLamports: params.tipLamports,
  };

  if (payload.kind === "transaction") {
    const user = buildUserTransaction(ctx, payload, params);
    const tipTx = signMessage(
      [tipIx],
      ctx.config.wallet.publicKey,
      params.blockhash,
      [ctx.config.wallet],
    );
    return {
      ...meta,
      base64Txs: [serialize(user.tx), serialize(tipTx)],
      signature: user.signature,
      blockhash: user.blockhash,
      lastValidBlockHeight: user.lastValidBlockHeight,
    };
  }

  const { instructions, feePayer, signers } = resolveBuildable(ctx, payload);
  const tx = signMessage(
    [...instructions, tipIx],
    feePayer,
    params.blockhash,
    withWalletSigner(ctx, signers),
  );
  return {
    ...meta,
    base64Txs: [serialize(tx)],
    signature: signatureOf(tx),
    blockhash: params.blockhash,
    lastValidBlockHeight: params.lastValidBlockHeight,
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
