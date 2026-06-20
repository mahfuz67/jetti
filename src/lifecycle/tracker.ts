import type { StageRecord } from "@/core/types";
import type {
  SlotEvent,
  TxEvent,
  YellowstoneStream,
} from "@/stream/yellowstone";
import { child } from "@/core/logger";

const log = child({ mod: "lifecycle" });

export interface TrackResult {
  landed: boolean;
  landedSlot: number | null;
  stages: StageRecord[];
  txErr: unknown;
}

export type StageListener = (
  stage: StageRecord["stage"],
  slot: number,
  at: number,
) => void;

export interface TrackOptions {
  pollEarlyExit?: () => Promise<boolean>;
  pollIntervalMs?: number;
  onStage?: StageListener;
}

interface Pending {
  signature: string;
  landedSlot: number | null;
  txErr: unknown;
  stages: StageRecord[];
  onStage?: StageListener;
  settle: (result: TrackResult) => void;
}

export class LifecycleTracker {
  private latestSlot = 0;
  private confirmedWatermark = 0;
  private finalizedWatermark = 0;
  private slotWaiters: Array<() => void> = [];
  private readonly pending = new Map<string, Pending>();

  constructor(stream: YellowstoneStream) {
    stream.on("slot", (e) => this.onSlot(e));
    stream.on("transaction", (e) => this.onTransaction(e));
  }

  get currentSlot(): number {
    return this.latestSlot;
  }

  waitForSlot(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let fn: () => void;
      const timer = setTimeout(() => {
        this.slotWaiters = this.slotWaiters.filter((w) => w !== fn);
        resolve();
      }, timeoutMs);
      fn = () => {
        clearTimeout(timer);
        resolve();
      };
      this.slotWaiters.push(fn);
    });
  }

  track(
    signature: string,
    timeoutMs: number,
    options: TrackOptions = {},
  ): Promise<TrackResult> {
    return new Promise<TrackResult>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      let poller: ReturnType<typeof setInterval> | undefined;
      const entry: Pending = {
        signature,
        landedSlot: null,
        txErr: null,
        stages: [{ stage: "submitted", slot: null, at: Date.now() }],
        onStage: options.onStage,
        settle: (result) => {
          clearTimeout(timer);
          if (poller) clearInterval(poller);
          this.pending.delete(signature);
          resolve(result);
        },
      };
      this.pending.set(signature, entry);

      timer = setTimeout(() => {
        // A transaction that reached `confirmed` has landed (supermajority vote);
        // finalization may simply not have arrived within the window yet. Treating
        // only `finalized` as landed here would mislabel real landings as failures.
        entry.settle({
          landed: this.hasStage(entry, "confirmed"),
          landedSlot: entry.landedSlot,
          stages: entry.stages,
          txErr: entry.txErr,
        });
      }, timeoutMs);

      if (options.pollEarlyExit) {
        const poll = options.pollEarlyExit;
        let polling = false;
        poller = setInterval(async () => {
          if (polling || entry.landedSlot !== null) return;
          polling = true;
          let failed = false;
          try {
            failed = await poll();
          } catch {
            failed = false;
          } finally {
            polling = false;
          }
          if (failed && this.pending.get(signature) === entry && entry.landedSlot === null) {
            entry.settle({
              landed: false,
              landedSlot: null,
              stages: entry.stages,
              txErr: entry.txErr,
            });
          }
        }, options.pollIntervalMs ?? 2_000);
      }
    });
  }

  private onTransaction(e: TxEvent): void {
    const entry = this.pending.get(e.signature);
    if (!entry) return;
    entry.landedSlot = e.slot;
    entry.txErr = e.err;
    this.addStage(entry, "processed", e.slot);
    this.tryAdvance(entry);
  }

  private onSlot(e: SlotEvent): void {
    if (e.slot > this.latestSlot) this.latestSlot = e.slot;
    if (e.status === "confirmed" && e.slot > this.confirmedWatermark)
      this.confirmedWatermark = e.slot;
    if (e.status === "finalized" && e.slot > this.finalizedWatermark)
      this.finalizedWatermark = e.slot;
    for (const entry of this.pending.values()) this.tryAdvance(entry);

    if (this.slotWaiters.length > 0) {
      const waiters = this.slotWaiters;
      this.slotWaiters = [];
      for (const w of waiters) w();
    }
  }

  private tryAdvance(entry: Pending): void {
    if (entry.landedSlot === null) return;

    if (
      this.confirmedWatermark >= entry.landedSlot &&
      !this.hasStage(entry, "confirmed")
    ) {
      this.addStage(entry, "confirmed", entry.landedSlot);
    }

    if (
      this.finalizedWatermark >= entry.landedSlot &&
      !this.hasStage(entry, "finalized")
    ) {
      this.addStage(entry, "finalized", entry.landedSlot);
      entry.settle({
        landed: true,
        landedSlot: entry.landedSlot,
        stages: entry.stages,
        txErr: entry.txErr,
      });
    }
  }

  private addStage(
    entry: Pending,
    stage: StageRecord["stage"],
    slot: number,
  ): void {
    if (this.hasStage(entry, stage)) return;
    const at = Date.now();
    entry.stages.push({ stage, slot, at });
    entry.onStage?.(stage, slot, at);
    log.debug({ sig: entry.signature, stage, slot }, "stage advanced");
  }

  private hasStage(entry: Pending, stage: StageRecord["stage"]): boolean {
    return entry.stages.some((s) => s.stage === stage);
  }
}
