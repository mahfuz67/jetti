import { randomUUID } from "node:crypto";
import type { JettiContext } from "@/context";
import { child } from "@/core/logger";
import { getCachedBlockhash } from "@/core/blockhash";
import { readNetworkConditions, type NetworkConditions } from "@/conditions";
import { leaderWindowAt } from "@/leader/schedule";
import { buildBundle, type BundlePayload } from "@/bundle/build";
import {
  getInflightBundleStatuses,
  sendBundle,
  type InflightStatus,
} from "@/bundle/jito-client";
import { classifyFailure } from "@/failure/classify";
import { decideRetry } from "@/ai/agent";
import { appendLifecycle } from "@/logs/writer";
import { stageDeltas } from "@/lifecycle/deltas";
import { forceExpiredBlockhash } from "@/faultinject/blockhash";
import type { LifecycleTracker, TrackResult } from "@/lifecycle/tracker";
import type { JettiEvent } from "@/events";
import type {
  BundleAttempt,
  BundleLifecycle,
  FailureInfo,
  Lamports,
  NetworkSnapshot,
  StageRecord,
} from "@/core/types";

const log = child({ mod: "orchestrator" });

const BLOCKHASH_VALIDITY_SLOTS = 150;
// `Invalid` from Jito can mean "not registered yet" right after submit, not just
// "lost". Honor it as a terminal failure only after the bundle has been live this
// long; `Failed` is always honored immediately.
const INVALID_GRACE_MS = 2_500;
const INFLIGHT_POLL_MS = 1_000;

// Capture the processed→confirmed latency of any attempt that reached confirmed,
// so the agent can read a live network-health signal on its next decision.
const recordConfirmDelta = (ctx: JettiContext, stages: StageRecord[]): void => {
  const delta = stageDeltas(stages).processed_to_confirmed;
  if (typeof delta !== "number") return;
  ctx.stats.confirmDeltas.push(delta);
  if (ctx.stats.confirmDeltas.length > 20) ctx.stats.confirmDeltas.shift();
};

const medianConfirmDelta = (ctx: JettiContext): number | null => {
  const deltas = ctx.stats.confirmDeltas;
  if (deltas.length === 0) return null;
  const sorted = [...deltas].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

export interface SubmitOptions {
  payload: BundlePayload;
  maxAttempts: number;
  injectExpiry: boolean;
  trackTimeoutMs: number;
  onEvent?: (event: JettiEvent) => void;
}

const recordOutcome = (ctx: JettiContext, landed: boolean): void => {
  ctx.stats.outcomes.push(landed);
  if (ctx.stats.outcomes.length > 20) ctx.stats.outcomes.shift();
};

const landRate = (ctx: JettiContext): number => {
  const outcomes = ctx.stats.outcomes;
  if (outcomes.length === 0) return 1;
  return outcomes.filter(Boolean).length / outcomes.length;
};

const getBlockhash = async (ctx: JettiContext, injectExpiry: boolean) =>
  injectExpiry ? forceExpiredBlockhash(ctx) : getCachedBlockhash(ctx);

const readCurrentSlot = async (
  ctx: JettiContext,
  tracker: LifecycleTracker,
): Promise<number> =>
  tracker.currentSlot || ctx.connection.getSlot("confirmed");

const inflightStatus = async (
  ctx: JettiContext,
  bundleId: string | null,
): Promise<InflightStatus["status"] | null> => {
  if (!bundleId) return null;
  try {
    const r = await getInflightBundleStatuses(ctx, [bundleId]);
    return r.value[0]?.status ?? null;
  } catch {
    return null;
  }
};

// Hold until a leader submission window opens; returns whether one did within
// the budget. Deterministic infra timing — distinct from the AI's retry call.
const ensureLeaderWindow = async (
  ctx: JettiContext,
  tracker: LifecycleTracker,
  maxMs = 2_500,
): Promise<boolean> => {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const slot = await readCurrentSlot(ctx, tracker);
    if ((await leaderWindowAt(ctx, slot)).windowOpen) return true;
    await tracker.waitForSlot(Math.min(500, deadline - Date.now()));
  }
  return false; // no window opened in time — caller submits anyway rather than stall
};

const timed = async <T>(
  bucket: Record<string, number>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    bucket[key] = Math.round(performance.now() - start);
  }
};

export const submitWithRetry = async (
  ctx: JettiContext,
  tracker: LifecycleTracker,
  opts: SubmitOptions,
): Promise<BundleLifecycle> => {
  const emit = opts.onEvent ?? (() => {});
  const lifecycle: BundleLifecycle = {
    id: randomUUID(),
    signature: null,
    region: ctx.config.jito.region,
    attempts: [],
    landed: false,
    landedSlot: null,
    startedAt: Date.now(),
    endedAt: null,
  };

  const initial = await readNetworkConditions(ctx);
  let tipLamports: Lamports = initial.baseTip;
  // Eager (stale) blockhash only for the fault demo; the normal path defers the
  // fetch to the leader window. Every subsequent refresh is owned by the agent.
  let bh = opts.injectExpiry ? await getBlockhash(ctx, true) : null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const timings: Record<string, number> = {};

    if (!opts.injectExpiry) {
      const open = await timed(timings, "window_wait", () =>
        ensureLeaderWindow(ctx, tracker),
      );
      if (open)
        bh = await timed(timings, "blockhash", () => getBlockhash(ctx, false));
      log.info(
        { attempt, windowOpen: open },
        open
          ? "leader window open, submitting"
          : "no window in time, submitting anyway",
      );
    }
    if (!bh)
      bh = await timed(timings, "blockhash", () => getBlockhash(ctx, false));
    const blockhash = bh;

    const built = await timed(timings, "build", () =>
      buildBundle(ctx, opts.payload, { ...blockhash, tipLamports }),
    );
    lifecycle.signature = built.signature;

    const attemptRec: BundleAttempt = {
      attempt,
      bundleId: null,
      tipLamports,
      blockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
      stages: [],
      timings,
      failure: null,
      decision: null,
    };

    let sendErr: unknown = null;
    let lastInflight: InflightStatus["status"] | null = null;
    let track: TrackResult = {
      landed: false,
      landedSlot: null,
      stages: [{ stage: "submitted", slot: null, at: Date.now() }],
      txErr: null,
    };

    try {
      const bundleId = await timed(timings, "send", () =>
        sendBundle(ctx, built.base64Txs),
      );
      attemptRec.bundleId = bundleId;
      log.info(
        { attempt, bundleId, tip: tipLamports },
        "bundle submitted",
      );
      emit({ type: "submitted", attempt, bundleId, tipLamports });
      const sentAt = Date.now();
      track = await timed(timings, "track", () =>
        tracker.track(built.signature, opts.trackTimeoutMs, {
          pollIntervalMs: INFLIGHT_POLL_MS,
          onStage: (stage, slot, at) => {
            if (stage === "processed") emit({ type: "processed", slot, at });
            else if (stage === "confirmed") emit({ type: "confirmed", slot, at });
            else if (stage === "finalized") emit({ type: "finalized", slot, at });
          },
          pollEarlyExit: async () => {
            lastInflight = await inflightStatus(ctx, bundleId);
            if (lastInflight === "Failed") return true;
            if (lastInflight === "Invalid")
              return Date.now() - sentAt > INVALID_GRACE_MS;
            return false;
          },
        }),
      );
    } catch (err) {
      sendErr = err;
      log.warn({ attempt, err: String(err) }, "sendBundle failed");
    }
    attemptRec.stages = track.stages;
    recordConfirmDelta(ctx, track.stages);

    if (track.landed) {
      lifecycle.landed = true;
      lifecycle.landedSlot = track.landedSlot;
      lifecycle.attempts.push(attemptRec);
      emit({ type: "landed", slot: track.landedSlot, signature: built.signature });
      break;
    }

    // One shared read of block height, network conditions, and inflight status.
    const inflightPromise: Promise<InflightStatus["status"] | null> =
      lastInflight !== null
        ? Promise.resolve(lastInflight)
        : inflightStatus(ctx, attemptRec.bundleId);
    const [currentBlockHeight, conditions, inflight] = await timed(
      timings,
      "classify_reads",
      () =>
        Promise.all([
          ctx.connection.getBlockHeight("confirmed"),
          readNetworkConditions(ctx),
          inflightPromise,
        ]),
    );

    const failure = classifyOutcome(
      track,
      sendErr,
      tipLamports,
      currentBlockHeight,
      attemptRec.lastValidBlockHeight,
      conditions,
      inflight,
    );
    attemptRec.failure = failure;
    emit({ type: "failure", attempt, failure });

    if (attempt >= opts.maxAttempts) {
      lifecycle.attempts.push(attemptRec);
      break;
    }

    const snapshot = await timed(timings, "snapshot", () =>
      buildSnapshot(
        ctx,
        tracker,
        attemptRec,
        failure,
        tipLamports,
        attempt,
        opts.maxAttempts,
        currentBlockHeight,
        conditions,
      ),
    );
    // Refresh the blockhash in parallel with the agent call; discarded on ABORT.
    const pendingRefresh = getBlockhash(ctx, false);
    const decision = await timed(timings, "ai_decide", () =>
      decideRetry(ctx, snapshot),
    );
    attemptRec.decision = decision;
    lifecycle.attempts.push(attemptRec);
    emit({ type: "decision", attempt, decision });

    if (decision.action === "ABORT") {
      void pendingRefresh.catch(() => {});
      emit({ type: "aborted", attempt, reason: decision.reasoning });
      break;
    }

    tipLamports = decision.newTipLamports;
    // The agent owns the refresh: a stale blockhash is only replaced if it asks.
    if (decision.refreshBlockhash) bh = await pendingRefresh;
    else void pendingRefresh.catch(() => {});
    if (decision.waitForLeaderWindow) await ensureLeaderWindow(ctx, tracker);
  }

  lifecycle.endedAt = Date.now();
  recordOutcome(ctx, lifecycle.landed);
  log.info(
    {
      landed: lifecycle.landed,
      attempts: lifecycle.attempts.length,
      landRate: landRate(ctx),
    },
    "lifecycle complete",
  );
  appendLifecycle(lifecycle);
  emit({ type: "complete", lifecycle });
  return lifecycle;
};

const classifyOutcome = (
  track: TrackResult,
  sendErr: unknown,
  tipLamports: Lamports,
  currentBlockHeight: number,
  lastValidBlockHeight: number,
  conditions: NetworkConditions,
  inflight: InflightStatus["status"] | null,
): FailureInfo =>
  classifyFailure({
    landed: false,
    inflight,
    txErr: track.txErr ?? sendErr,
    currentBlockHeight,
    lastValidBlockHeight,
    usedTipLamports: tipLamports,
    tips: conditions.tips,
  }) ?? { class: "UNKNOWN", detail: "unclassified failure" };

const buildSnapshot = async (
  ctx: JettiContext,
  tracker: LifecycleTracker,
  attemptRec: BundleAttempt,
  failure: FailureInfo,
  tipLamports: Lamports,
  attempt: number,
  maxAttempts: number,
  currentBlockHeight: number,
  conditions: NetworkConditions,
): Promise<NetworkSnapshot> => {
  const currentSlot = await readCurrentSlot(ctx, tracker);
  const window = await leaderWindowAt(ctx, currentSlot);
  const slotsRemaining = attemptRec.lastValidBlockHeight - currentBlockHeight;

  return {
    failure,
    currentSlot,
    lastValidBlockHeight: attemptRec.lastValidBlockHeight,
    currentBlockHeight,
    blockhashAgeSlots: Math.max(0, BLOCKHASH_VALIDITY_SLOTS - slotsRemaining),
    previousTipLamports: tipLamports,
    tips: conditions.tips,
    recentLandRate: landRate(ctx),
    recentProcessedToConfirmedMs: medianConfirmDelta(ctx),
    leaderWindowOpen: window.windowOpen,
    currentLeader: window.currentLeader,
    slotsRemainingInLeaderTurn: window.slotsRemainingInTurn,
    attempt,
    maxAttempts,
  };
};
