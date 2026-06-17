import pino, { type LoggerOptions } from "pino";

const options: LoggerOptions = { level: process.env.LOG_LEVEL ?? "info" };

if (process.env.NODE_ENV !== "production") {
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
