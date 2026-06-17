import { readdirSync, readFileSync, existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { stageDeltas } from "@/lifecycle/deltas";
import type { BundleLifecycle } from "@/core/types";

const arg = process.argv[2];

const hasLogs = (dir: string): boolean =>
  existsSync(dir) &&
  readdirSync(dir).some(
    (f) => f.startsWith("lifecycle-") && f.endsWith(".jsonl"),
  );

const resolveSource = (): string => {
  if (arg) return isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
  const samples = join(process.cwd(), "logs", "samples");
  return hasLogs(samples) ? samples : join(process.cwd(), "logs");
};

const readLifecycles = (source: string): BundleLifecycle[] => {
  const files = source.endsWith(".jsonl")
    ? [source]
    : readdirSync(source)
        .filter((f) => f.startsWith("lifecycle-") && f.endsWith(".jsonl"))
        .map((f) => join(source, f));

  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as BundleLifecycle),
  );
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
};

const fmt = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString() : "—";

const landedAttemptOf = (lc: BundleLifecycle): number | null => {
  if (!lc.landed) return null;
  return lc.attempts.length; // the loop breaks on the landing attempt
};

const main = (): void => {
  const source = resolveSource();
  const lifecycles = readLifecycles(source);
  if (lifecycles.length === 0) {
    console.log(`No lifecycle records found at ${source}`);
    return;
  }

  const landed = lifecycles.filter((lc) => lc.landed);
  const attemptsHist = new Map<string, number>();
  const deltas: Record<string, number[]> = {
    submitted_to_processed: [],
    processed_to_confirmed: [],
    confirmed_to_finalized: [],
  };
  const landedTips: number[] = [];
  const notLandedTips: number[] = [];
  const failures = new Map<string, number>();
  const decisions = { RETRY: 0, ABORT: 0, refresh: 0, wait: 0 };

  for (const lc of lifecycles) {
    const landedAttempt = landedAttemptOf(lc);
    const key = landedAttempt
      ? `landed@attempt${landedAttempt}`
      : "never landed";
    attemptsHist.set(key, (attemptsHist.get(key) ?? 0) + 1);

    for (const a of lc.attempts) {
      const d = a.deltas ?? stageDeltas(a.stages);
      for (const stage of Object.keys(deltas)) {
        const v = d[stage];
        if (typeof v === "number") deltas[stage]!.push(v);
      }
      if (a.failure)
        failures.set(a.failure.class, (failures.get(a.failure.class) ?? 0) + 1);
      if (a.decision) {
        decisions[a.decision.action] += 1;
        if (a.decision.refreshBlockhash) decisions.refresh += 1;
        if (a.decision.waitForLeaderWindow) decisions.wait += 1;
      }
    }

    const finalTip = lc.attempts[lc.attempts.length - 1]?.tipLamports;
    if (finalTip !== undefined)
      (lc.landed ? landedTips : notLandedTips).push(finalTip);
  }

  const pct = (n: number): string =>
    `${((n / lifecycles.length) * 100).toFixed(1)}%`;

  console.log(`\nLIFECYCLE REPORT — ${source}`);
  console.log("=".repeat(64));
  console.log(
    `Bundles: ${lifecycles.length}  |  Landed: ${landed.length} (${pct(landed.length)})  |  Failed: ${lifecycles.length - landed.length}`,
  );

  console.log("\nOutcome by attempt");
  for (const [k, v] of [...attemptsHist.entries()].sort())
    console.log(`  ${k.padEnd(20)} ${v}`);

  console.log(
    "\nStage latency (ms)            n     p50     p90     max   note",
  );
  const noteOf: Record<string, string> = {
    submitted_to_processed: "submit → block inclusion",
    processed_to_confirmed: "vote/consensus latency",
    confirmed_to_finalized: "~32-slot finalization lag",
  };
  for (const [stage, arr] of Object.entries(deltas)) {
    const max = arr.length > 0 ? Math.max(...arr) : NaN;
    console.log(
      `  ${stage.padEnd(24)} ${String(arr.length).padStart(4)} ${fmt(percentile(arr, 0.5)).padStart(7)} ${fmt(percentile(arr, 0.9)).padStart(7)} ${fmt(max).padStart(7)}   ${noteOf[stage]}`,
    );
  }

  console.log("\nTips (lamports)");
  console.log(
    `  landed     median ${fmt(percentile(landedTips, 0.5))}  (n=${landedTips.length})`,
  );
  console.log(
    `  not landed median ${fmt(percentile(notLandedTips, 0.5))}  (n=${notLandedTips.length})`,
  );

  console.log("\nFailures by class");
  if (failures.size === 0) console.log("  (none)");
  for (const [cls, n] of [...failures.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${cls.padEnd(20)} ${n}`);

  console.log("\nAI agent decisions");
  console.log(
    `  RETRY ${decisions.RETRY}  |  ABORT ${decisions.ABORT}  |  refreshBlockhash ${decisions.refresh}  |  waitForLeaderWindow ${decisions.wait}`,
  );
  console.log("");
};

main();
