"use client";
import type { StreamEvent } from "@/lib/events";

const dotColor: Record<string, string> = {
  submitted: "bg-cyan-400",
  processed: "bg-blue-400",
  confirmed: "bg-emerald-400",
  finalized: "bg-emerald-500",
  failure: "bg-amber-400",
  decision: "bg-fuchsia-400",
  landed: "bg-emerald-400",
  aborted: "bg-red-400",
  error: "bg-red-500",
  result: "bg-emerald-400",
};

function describe(e: StreamEvent): { title: string; detail?: string } {
  switch (e.type) {
    case "submitted":
      return {
        title: `Submitted — attempt ${e.attempt}`,
        detail: `tip ${e.tipLamports} · bundle ${e.bundleId ?? "-"}`,
      };
    case "processed":
      return { title: "Processed", detail: `slot ${e.slot}` };
    case "confirmed":
      return { title: "Confirmed", detail: `slot ${e.slot}` };
    case "finalized":
      return { title: "Finalized", detail: `slot ${e.slot}` };
    case "failure":
      return { title: `Failure — ${e.failure.class}`, detail: e.failure.detail };
    case "decision":
      return {
        title: `AI ${e.decision.action} — tip ${e.decision.newTipLamports}`,
        detail: e.decision.reasoning,
      };
    case "landed":
      return { title: "Landed", detail: `slot ${e.slot} · ${e.signature ?? "-"}` };
    case "aborted":
      return { title: "Aborted", detail: e.reason };
    case "error":
      return { title: "Error", detail: e.message };
    case "result":
      return {
        title: e.landed ? "Landed" : "Not landed",
        detail: e.landedSlot ? `slot ${e.landedSlot}` : undefined,
      };
    case "complete":
      return { title: "Complete" };
  }
}

export function Timeline({ events }: { events: StreamEvent[] }) {
  const visible = events.filter((e) => e.type !== "complete");
  if (visible.length === 0)
    return <p className="text-sm text-neutral-500">No events yet.</p>;

  return (
    <ol className="space-y-3">
      {visible.map((e, i) => {
        const { title, detail } = describe(e);
        return (
          <li key={i} className="flex gap-3">
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor[e.type] ?? "bg-neutral-500"}`}
            />
            <div>
              <p className="text-sm font-medium">{title}</p>
              {detail && (
                <p className="break-all text-xs text-neutral-400">{detail}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
