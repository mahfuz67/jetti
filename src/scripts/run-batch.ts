import { startStream } from "@/stream/ready";
import { LifecycleTracker } from "@/lifecycle/tracker";
import { submitWithRetry } from "@/retry/orchestrator";
import { renderLifecycle } from "@/logs/render";
import { sleep } from "@/core/sleep";
import { logger } from "@/core/logger";

const TOTAL = Number.parseInt(process.argv[2] ?? "12", 10);
const FAULT_AT = new Set([3, 8]);

const main = async (): Promise<void> => {
  const stream = await startStream();
  const tracker = new LifecycleTracker(stream);

  let landed = 0;
  let failedAttempts = 0;

  for (let i = 1; i <= TOTAL; i++) {
    logger.info({ run: i, of: TOTAL }, "submitting");
    const lifecycle = await submitWithRetry(tracker, {
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
  stream.stop();
  process.exit(0);
};

void main();
