import { EventEmitter } from "node:events";
import type { JettiConfig } from "@/config/env";
import { createContext, type JettiContext } from "@/context";
import { YellowstoneStream } from "@/stream/yellowstone";
import { startStream } from "@/stream/ready";
import {
  LifecycleTracker,
  type TrackResult,
  type StageListener,
} from "@/lifecycle/tracker";
import { warmup } from "@/core/warmup";
import { getCachedBlockhash, stopBlockhashRefresher } from "@/core/blockhash";
import { submitWithRetry } from "@/retry/orchestrator";
import { readNetworkConditions, type NetworkConditions } from "@/conditions";
import { classifyFailure, type ClassifyInput } from "@/failure/classify";
import {
  buildBundle,
  type BundlePayload,
  type BuiltBundle,
} from "@/bundle/build";
import { simulateBundle, type SimulateResult } from "@/bundle/simulate";
import type { JettiEvent, SendRequest } from "@/events";
import type { BundleLifecycle, FailureInfo, Lamports } from "@/core/types";

const DEFAULT_TRACK_TIMEOUT_MS = 45_000;

export class Jetti extends EventEmitter {
  readonly ctx: JettiContext;
  readonly tracker: LifecycleTracker;
  private readonly stream: YellowstoneStream;
  private started = false;

  constructor(config: JettiConfig) {
    super();
    this.ctx = createContext(config);
    this.stream = new YellowstoneStream(config);
    this.tracker = new LifecycleTracker(this.stream);
  }

  async start(): Promise<void> {
    if (this.started) return;
    await startStream(this.stream);
    await warmup(this.ctx);
    this.started = true;
  }

  stop(): void {
    this.stream.stop();
    stopBlockhashRefresher(this.ctx);
    this.started = false;
  }

  send(req: SendRequest): Promise<BundleLifecycle> {
    const onEvent = (event: JettiEvent): void => {
      this.emit("event", event);
      this.emit(event.type, event);
      req.onEvent?.(event);
    };
    return submitWithRetry(this.ctx, this.tracker, {
      payload: req.payload,
      maxAttempts: req.maxAttempts ?? 3,
      injectExpiry: req.injectExpiry ?? false,
      trackTimeoutMs: req.trackTimeoutMs ?? DEFAULT_TRACK_TIMEOUT_MS,
      onEvent,
    });
  }

  track(
    signature: string,
    timeoutMs = DEFAULT_TRACK_TIMEOUT_MS,
    onStage?: StageListener,
  ): Promise<TrackResult> {
    return this.tracker.track(signature, timeoutMs, { onStage });
  }

  conditions(): Promise<NetworkConditions> {
    return readNetworkConditions(this.ctx);
  }

  async recommendTip(): Promise<Lamports> {
    return (await readNetworkConditions(this.ctx)).baseTip;
  }

  classify(input: ClassifyInput): FailureInfo {
    return (
      classifyFailure(input) ?? {
        class: "UNKNOWN",
        detail: "unclassified failure",
      }
    );
  }

  simulate(payload: BundlePayload): Promise<SimulateResult> {
    return simulateBundle(this.ctx, payload);
  }

  async buildBundle(payload: BundlePayload): Promise<BuiltBundle> {
    const [bh, conditions] = await Promise.all([
      getCachedBlockhash(this.ctx),
      readNetworkConditions(this.ctx),
    ]);
    return buildBundle(this.ctx, payload, {
      blockhash: bh.blockhash,
      lastValidBlockHeight: bh.lastValidBlockHeight,
      tipLamports: conditions.baseTip,
    });
  }
}
