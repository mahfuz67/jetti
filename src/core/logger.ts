import pino, { type LoggerOptions } from "pino";

const options: LoggerOptions = { level: process.env.LOG_LEVEL ?? "info" };

// pino-pretty runs as a worker-thread transport that can't be resolved inside a
// bundled server runtime (e.g. Next.js, which sets NEXT_RUNTIME); fall back to
// plain JSON logging there.
if (process.env.NODE_ENV !== "production" && !process.env.NEXT_RUNTIME) {
  options.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:HH:MM:ss.l",
      ignore: "pid,hostname",
    },
  };
}

export const logger = pino(options);

export type Logger = typeof logger;

export const child = (bindings: Record<string, unknown>): Logger =>
  logger.child(bindings);
