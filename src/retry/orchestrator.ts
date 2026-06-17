import { randomUUID } from "node:crypto";
import { connection } from "@/core/connection";
import { config } from "@/config/env";
import { child } from "@/core/logger";
import { sleep } from "@/core/sleep";
import { readNetworkConditions, type NetworkConditions } from "@/core/network";
import { leaderWindowAt } from "@/leader/schedule";
import { buildProbeBundle } from "@/bundle/build";
import { getInflightBundleStatuses, sendBundle } from "@/bundle/jito-client";
import { classifyFailure } from "@/failure/classify";
import { decideRetry } from "@/ai/agent";
import { appendLifecycle } from "@/logs/writer";
import { stageDeltas } from "@/lifecycle/deltas";
import { forceExpiredBlockhash } from "@/faultinject/blockhash";
import type { LifecycleTracker, TrackResult } from "@/lifecycle/tracker";
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
const recentOutcomes: boolean[] = [];
const recentConfirmDeltas: number[] = [];

// Capture the processed→confirmed latency of any attempt that reached confirmed,
// so the agent can read a live network-health signal on its next decision.
const recordConfirmDelta = (stages: StageRecord[]): void => {
  const delta = stageDeltas(stages).processed_to_confirmed;
  if (typeof delta !== "number") return;
  recentConfirmDeltas.push(delta);
  if (recentConfirmDeltas.length > 20) recentConfirmDeltas.shift();
};

const medianConfirmDelta = (): number | null => {
  if (recentConfirmDeltas.length === 0) return null;
  const sorted = [...recentConfirmDeltas].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

export interface SubmitOptions {
  maxAttempts: number;
  injectExpiry: boolean;
  trackTimeoutMs: number;
}

const recordOutcome = (landed: boolean): void => {
  recentOutcomes.push(landed);
  if (recentOutcomes.length > 20) recentOutcomes.shift();
};

const landRate = (): number => {
  if (recentOutcomes.length === 0) return 1;
  return recentOutcomes.filter(Boolean).length / recentOutcomes.length;
};

const getBlockhash = async (injectExpiry: boolean) => {
  if (injectExpiry) return forceExpiredBlockhash();
  const latest = await connection.getLatestBlockhash("confirmed");
  return {
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
};

// Hold until a leader submission window opens; returns whether one did within
// the budget. Deterministic infra timing — distinct from the AI's retry call.
const ensureLeaderWindow = async (maxMs = 2_500): Promise<boolean> => {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const slot = await connection.getSlot("confirmed");
    if ((await leaderWindowAt(slot)).windowOpen) return true;
    await sleep(200);
  }
  return false; // no window opened in time — caller submits anyway rather than stall
};

export const submitWithRetry = async (
  tracker: LifecycleTracker,
  opts: SubmitOptions,
): Promise<BundleLifecycle> => {
  const lifecycle: BundleLifecycle = {
    id: randomUUID(),
    signature: null,
    region: config.jito.region,
    attempts: [],
    landed: false,
    landedSlot: null,
    startedAt: Date.now(),
    endedAt: null,
  };

  const initial = await readNetworkConditions();
  let tipLamports: Lamports = initial.baseTip;
  // The first attempt may carry an injected (stale) blockhash. Every subsequent
  // refresh is owned by the agent via decision.refreshBlockhash — never hardcoded.
  let bh = await getBlockhash(opts.injectExpiry);

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    // Enforce submission into a leader window before every send. Skipped under
    // fault injection, where the expiry demo must submit with the stale blockhash
    // immediately. Refresh after waiting so the hold doesn't eat validity runway.
    if (!opts.injectExpiry) {
      const open = await ensureLeaderWindow();
      if (open) bh = await getBlockhash(false);
      log.info(
        { attempt, windowOpen: open },
        open
          ? "leader window open, submitting"
          : "no window in time, submitting anyway",
      );
    }

    const built = await buildProbeBundle({ ...bh, tipLamports });
    lifecycle.signature = built.signature;

    const attemptRec: BundleAttempt = {
      attempt,
      bundleId: null,
      tipLamports,
      blockhash: bh.blockhash,
      lastValidBlockHeight: bh.lastValidBlockHeight,
      stages: [],
      failure: null,
      decision: null,
    };

    let sendErr: unknown = null;
    let track: TrackResult = {
      landed: false,
      landedSlot: null,
      stages: [{ stage: "submitted", slot: null, at: Date.now() }],
      txErr: null,
    };

    try {
      attemptRec.bundleId = await sendBundle(built.base64Txs);
      log.info(
        { attempt, bundleId: attemptRec.bundleId, tip: tipLamports },
        "bundle submitted",
      );
      track = await tracker.track(built.signature, opts.trackTimeoutMs);
    } catch (err) {
      sendErr = err;
      log.warn({ attempt, err: String(err) }, "sendBundle failed");
    }
    attemptRec.stages = track.stages;
    recordConfirmDelta(track.stages);

    if (track.landed) {
      lifecycle.landed = true;
      lifecycle.landedSlot = track.landedSlot;
      lifecycle.attempts.push(attemptRec);
      break;
    }

    // One read of block height + network conditions, shared by both the failure
    // classification and the agent snapshot, so they reason over identical data.
    const [currentBlockHeight, conditions] = await Promise.all([
      connection.getBlockHeight("confirmed"),
      readNetworkConditions(),
    ]);

    const failure = await classifyOutcome(
      attemptRec,
      track,
      sendErr,
      tipLamports,
      currentBlockHeight,
      conditions,
    );
    attemptRec.failure = failure;

    if (attempt >= opts.maxAttempts) {
      lifecycle.attempts.push(attemptRec);
      break;
    }

    const snapshot = await buildSnapshot(
      attemptRec,
      failure,
      tipLamports,
      attempt,
      opts.maxAttempts,
      currentBlockHeight,
      conditions,
    );
    const decision = await decideRetry(snapshot);
    attemptRec.decision = decision;
    lifecycle.attempts.push(attemptRec);

    if (decision.action === "ABORT") break;

    tipLamports = decision.newTipLamports;
    // The agent owns the refresh: a stale blockhash is only replaced if it asks.
    if (decision.refreshBlockhash) bh = await getBlockhash(false);
    if (decision.waitForLeaderWindow) await ensureLeaderWindow();
  }

  lifecycle.endedAt = Date.now();
  recordOutcome(lifecycle.landed);
  log.info(
    {
      landed: lifecycle.landed,
      attempts: lifecycle.attempts.length,
      landRate: landRate(),
    },
    "lifecycle complete",
  );
  appendLifecycle(lifecycle);
  return lifecycle;
};

const classifyOutcome = async (
  attemptRec: BundleAttempt,
  track: TrackResult,
  sendErr: unknown,
  tipLamports: Lamports,
  currentBlockHeight: number,
  conditions: NetworkConditions,
): Promise<FailureInfo> => {
  const inflight = attemptRec.bundleId
    ? await getInflightBundleStatuses([attemptRec.bundleId])
        .then((r) => r.value[0]?.status ?? null)
        .catch(() => null)
    : null;

  return (
    classifyFailure({
      landed: false,
      inflight,
      txErr: track.txErr ?? sendErr,
      currentBlockHeight,
      lastValidBlockHeight: attemptRec.lastValidBlockHeight,
      usedTipLamports: tipLamports,
      tips: conditions.tips,
    }) ?? { class: "UNKNOWN", detail: "unclassified failure" }
  );
};

const buildSnapshot = async (
  attemptRec: BundleAttempt,
  failure: FailureInfo,
  tipLamports: Lamports,
  attempt: number,
  maxAttempts: number,
  currentBlockHeight: number,
  conditions: NetworkConditions,
): Promise<NetworkSnapshot> => {
  const currentSlot = await connection.getSlot("confirmed");
  const window = await leaderWindowAt(currentSlot);
  const slotsRemaining = attemptRec.lastValidBlockHeight - currentBlockHeight;

  return {
    failure,
    currentSlot,
    lastValidBlockHeight: attemptRec.lastValidBlockHeight,
    currentBlockHeight,
    blockhashAgeSlots: Math.max(0, BLOCKHASH_VALIDITY_SLOTS - slotsRemaining),
    previousTipLamports: tipLamports,
    tips: conditions.tips,
    recentLandRate: landRate(),
    recentProcessedToConfirmedMs: medianConfirmDelta(),
    leaderWindowOpen: window.windowOpen,
    currentLeader: window.currentLeader,
    slotsRemainingInLeaderTurn: window.slotsRemainingInTurn,
    attempt,
    maxAttempts,
  };
};
