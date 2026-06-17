import { appendFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { stageDeltas } from "@/lifecycle/deltas";
import type { BundleLifecycle } from "@/core/types";

// Scratch logs default to ./logs (gitignored). Point LOG_DIR at a committable
// path (e.g. logs/samples) to produce the submission artifact:
//   LOG_DIR=logs/samples yarn batch
const LOG_DIR = ((): string => {
  const override = process.env.LOG_DIR;
  if (!override) return join(process.cwd(), "logs");
  return isAbsolute(override) ? override : resolve(process.cwd(), override);
})();

const filePath = (): string => {
  const day = new Date().toISOString().slice(0, 10);
  return join(LOG_DIR, `lifecycle-${day}.jsonl`);
};

export const appendLifecycle = (record: BundleLifecycle): void => {
  mkdirSync(LOG_DIR, { recursive: true });
  // Enrich each attempt with its inter-stage latency deltas so the persisted
  // entry carries them directly rather than forcing readers to derive them.
  const serialized: BundleLifecycle = {
    ...record,
    attempts: record.attempts.map((a) => ({
      ...a,
      deltas: stageDeltas(a.stages),
    })),
  };
  appendFileSync(filePath(), `${JSON.stringify(serialized)}\n`);
};
