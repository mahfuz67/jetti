import type { JettiEvent } from "jetti";

export type StreamEvent =
  | JettiEvent
  | { type: "error"; message: string }
  | { type: "result"; landed: boolean; landedSlot: number | null };
