import { YellowstoneStream } from "@/stream/yellowstone";
import { logger } from "@/core/logger";

const stream = new YellowstoneStream();

stream.on("connect", () => logger.info("connected"));
stream.on("disconnect", (err) =>
  logger.warn({ err: String(err) }, "disconnected"),
);
stream.on("slot", (e) => {
  if (e.status === "processed" && e.slot % 10 === 0)
    logger.info({ slot: e.slot }, "processed");
  if (e.status === "confirmed") logger.debug({ slot: e.slot }, "confirmed");
  if (e.status === "finalized") logger.debug({ slot: e.slot }, "finalized");
});

process.on("SIGINT", () => {
  stream.stop();
  process.exit(0);
});

void stream.start();
