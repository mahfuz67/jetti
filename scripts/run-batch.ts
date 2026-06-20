import { Jetti } from "@/client";
import { loadConfigFromEnv } from "@/config/env";
import { renderLifecycle } from "@/logs/render";
import { sleep } from "@/core/sleep";
import { logger } from "@/core/logger";

const parsedTotal = Number.parseInt(process.argv[2] ?? "12", 10);
const TOTAL = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : 12;
const FAULT_AT = new Set([3, 8]);

const main = async (): Promise<void> => {
  const jetti = new Jetti(loadConfigFromEnv());
  await jetti.start();

  let landed = 0;
  let failedAttempts = 0;

  for (let i = 1; i <= TOTAL; i++) {
    logger.info({ run: i, of: TOTAL }, "submitting");
    const lifecycle = await jetti.send({
      payload: { kind: "probe" },
      maxAttempts: 3,
      injectExpiry: FAULT_AT.has(i),
      trackTimeoutMs: 45_000,
    });

    if (lifecycle.landed) landed++;
    failedAttempts += lifecycle.attempts.filter((a) => a.failure).length;
    logger.info(`\n${renderLifecycle(lifecycle)}`);
    await sleep(1_500);
  }

  logger.info({ TOTAL, landed, failedAttempts }, "batch complete");
  jetti.stop();
  process.exit(0);
};

void main();
