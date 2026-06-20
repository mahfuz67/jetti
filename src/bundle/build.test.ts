import { describe, expect, it } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { assembleBundle } from "./build";
import type { JettiContext } from "@/context";

const wallet = Keypair.generate();
const tipAccount = Keypair.generate().publicKey;
const fakeBlockhash = Keypair.generate().publicKey.toBase58();

// Only the wallet + probe tuning are needed for pure assembly.
const ctx = {
  config: { wallet, tuning: { probeTransferLamports: 1_000 } },
} as unknown as JettiContext;

const params = {
  blockhash: fakeBlockhash,
  lastValidBlockHeight: 1_000,
  tipLamports: 5_000,
};

describe("assembleBundle", () => {
  it("builds a single-tx bundle (tip inline) for a probe", () => {
    const bundle = assembleBundle(ctx, { kind: "probe" }, params, tipAccount);
    expect(bundle.base64Txs).toHaveLength(1);
    expect(bundle.tipAccount).toBe(tipAccount.toBase58());
    expect(bundle.tipLamports).toBe(5_000);
    expect(bundle.blockhash).toBe(fakeBlockhash);
    expect(typeof bundle.signature).toBe("string");
  });

  it("builds from caller instructions and signs with the provided signer", () => {
    const recipient = Keypair.generate().publicKey;
    const instructions = [
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: recipient,
        lamports: 1,
      }),
    ];
    const bundle = assembleBundle(
      ctx,
      { kind: "instructions", instructions, signers: [wallet] },
      params,
      tipAccount,
    );
    expect(bundle.base64Txs).toHaveLength(1);
    expect(bundle.lastValidBlockHeight).toBe(1_000);
  });

  it("uses a prebuilt transaction's own blockhash and provided validity", () => {
    const prebuiltBlockhash = Keypair.generate().publicKey.toBase58();
    const message = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: prebuiltBlockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: wallet.publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([wallet]);

    const bundle = assembleBundle(
      ctx,
      { kind: "transaction", transaction: tx, lastValidBlockHeight: 42 },
      params,
      tipAccount,
    );
    expect(bundle.blockhash).toBe(prebuiltBlockhash);
    expect(bundle.lastValidBlockHeight).toBe(42);
    expect(bundle.base64Txs).toHaveLength(2);
  });
});
