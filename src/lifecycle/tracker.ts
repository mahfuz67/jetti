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

interface Pending {
  signature: string;
  landedSlot: number | null;
  txErr: unknown;
  stages: StageRecord[];
  settle: (result: TrackResult) => void;
}

export class LifecycleTracker {
  private confirmedWatermark = 0;
  private finalizedWatermark = 0;
  private readonly pending = new Map<string, Pending>();

  constructor(stream: YellowstoneStream) {
    stream.on("slot", (e) => this.onSlot(e));
    stream.on("transaction", (e) => this.onTransaction(e));
  }

  track(signature: string, timeoutMs: number): Promise<TrackResult> {
    return new Promise<TrackResult>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const entry: Pending = {
        signature,
        landedSlot: null,
        txErr: null,
        stages: [{ stage: "submitted", slot: null, at: Date.now() }],
        settle: (result) => {
          clearTimeout(timer);
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
    if (e.status === "confirmed" && e.slot > this.confirmedWatermark)
      this.confirmedWatermark = e.slot;
    if (e.status === "finalized" && e.slot > this.finalizedWatermark)
      this.finalizedWatermark = e.slot;
    for (const entry of this.pending.values()) this.tryAdvance(entry);
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
    entry.stages.push({ stage, slot, at: Date.now() });
    log.debug({ sig: entry.signature, stage, slot }, "stage advanced");
  }

  private hasStage(entry: Pending, stage: StageRecord["stage"]): boolean {
    return entry.stages.some((s) => s.stage === stage);
  }
}
