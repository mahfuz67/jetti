import { Jetti } from "@/client";
import { loadConfigFromEnv } from "@/config/env";
import { renderLifecycle } from "@/logs/render";
import { logger } from "@/core/logger";

const main = async (): Promise<void> => {
  const jetti = new Jetti(loadConfigFromEnv());
  await jetti.start();

  logger.info(
    "injecting expired blockhash; the AI agent must detect, reason, refresh, retip, resubmit",
  );
  const lifecycle = await jetti.send({
    payload: { kind: "probe" },
    maxAttempts: 3,
    injectExpiry: true,
    trackTimeoutMs: 45_000,
  });

  logger.info(`\n${renderLifecycle(lifecycle)}`);
  jetti.stop();
  process.exit(0);
};

void main();
