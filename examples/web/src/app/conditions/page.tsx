"use client";
import { useEffect, useState } from "react";
import type { NetworkConditions } from "jetti";
import { Card } from "@/components/ui";

export default function ConditionsPage() {
  const [c, setC] = useState<NetworkConditions | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/conditions")
      .then((r) => r.json())
      .then(setC)
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Conditions</h1>
        <p className="text-sm text-neutral-400">
          Live tip floor, congestion, and the recommended opening tip.
        </p>
      </header>

      {err && <p className="text-sm text-red-400">{err}</p>}
      {!c && !err && <p className="text-sm text-neutral-500">Loading…</p>}

      {c && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-medium text-neutral-300">
              Tip floor (lamports)
            </h2>
            <dl className="space-y-1 text-sm">
              {(["p25", "p50", "p75", "p95", "p99"] as const).map((k) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-neutral-400">{k}</dt>
                  <dd className="tabular-nums">{c.tips[k].toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="space-y-4">
            <div>
              <h2 className="mb-1 text-sm font-medium text-neutral-300">
                Congestion
              </h2>
              <p className="text-2xl font-semibold tabular-nums">
                {(c.congestion.skipRate * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-neutral-500">skip rate</p>
            </div>
            <div>
              <h2 className="mb-1 text-sm font-medium text-neutral-300">
                Recommended base tip
              </h2>
              <p className="text-2xl font-semibold tabular-nums">
                {c.baseTip.toLocaleString()}
              </p>
              <p className="text-xs text-neutral-500">lamports</p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
