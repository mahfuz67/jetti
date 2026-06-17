import { startStream } from "@/stream/ready";
import { LifecycleTracker } from "@/lifecycle/tracker";
import { submitWithRetry } from "@/retry/orchestrator";
import { renderLifecycle } from "@/logs/render";
import { logger } from "@/core/logger";

const main = async (): Promise<void> => {
  const stream = await startStream();
  const tracker = new LifecycleTracker(stream);

  logger.info(
    "injecting expired blockhash; the AI agent must detect, reason, refresh, retip, resubmit",
  );
  const lifecycle = await submitWithRetry(tracker, {
    maxAttempts: 3,
    injectExpiry: true,
    trackTimeoutMs: 45_000,
  });

  logger.info(`\n${renderLifecycle(lifecycle)}`);
  stream.stop();
  process.exit(0);
};

void main();
