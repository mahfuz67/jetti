import { config } from "@/config/env";
import { connection } from "@/core/connection";
import { readNetworkConditions } from "@/core/network";
import { leaderWindowAt } from "@/leader/schedule";
import { getRandomTipAccount } from "@/bundle/tip-accounts";
import { buildProbeBundle } from "@/bundle/build";
import { logger } from "@/core/logger";

const main = async (): Promise<void> => {
  logger.info(
    { wallet: config.wallet.publicKey.toBase58(), region: config.jito.region },
    "config loaded",
  );

  const balance = await connection.getBalance(
    config.wallet.publicKey,
    "confirmed",
  );
  logger.info({ lamports: balance, sol: balance / 1e9 }, "wallet balance");

  const slot = await connection.getSlot("confirmed");
  const window = await leaderWindowAt(slot);
  logger.info(window, "leader window");

  const conditions = await readNetworkConditions();
  logger.info(
    {
      p50: conditions.tips.p50,
      p75: conditions.tips.p75,
      skipRate: conditions.congestion.skipRate,
      baseTip: conditions.baseTip,
    },
    "live tips + congestion",
  );

  const tipAccount = await getRandomTipAccount();
  logger.info(
    { tipAccount: tipAccount.toBase58() },
    "selected jito tip account",
  );

  const bh = await connection.getLatestBlockhash("confirmed");
  const bundle = await buildProbeBundle({
    blockhash: bh.blockhash,
    lastValidBlockHeight: bh.lastValidBlockHeight,
    tipLamports: conditions.baseTip,
  });
  logger.info(
    {
      signature: bundle.signature,
      txBytes: bundle.base64Txs[0]?.length,
      tip: bundle.tipLamports,
    },
    "bundle built + signed (not submitted)",
  );

  logger.info(
    "smoke test passed: config, RPC, leader, tips, tip-account, bundle build all work on real mainnet",
  );
};

main().then(
  () => process.exit(0),
  (err) => {
    logger.error(err, "smoke test failed");
    process.exit(1);
  },
);
