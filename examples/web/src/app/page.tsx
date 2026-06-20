"use client";
import { useState } from "react";
import type { StreamEvent } from "@/lib/events";
import { streamEvents } from "@/lib/stream";
import { Timeline } from "@/components/Timeline";
import { Button, Card, Input } from "@/components/ui";

const tab = (active: boolean): string =>
  `rounded-lg px-3 py-1.5 text-sm transition ${
    active
      ? "bg-neutral-800 text-neutral-100"
      : "text-neutral-400 hover:text-neutral-200"
  }`;

export default function SendPage() {
  const [mode, setMode] = useState<"probe" | "transfer">("probe");
  const [to, setTo] = useState("");
  const [lamports, setLamports] = useState("1000");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setEvents([]);
    setRunning(true);
    const body =
      mode === "probe" ? { mode } : { mode, to, lamports: Number(lamports) };
    try {
      await streamEvents<StreamEvent>("/api/send", body, (e) =>
        setEvents((prev) => [...prev, e]),
      );
    } catch (e) {
      setEvents((prev) => [
        ...prev,
        { type: "error", message: e instanceof Error ? e.message : String(e) },
      ]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Send</h1>
        <p className="text-sm text-neutral-400">
          Submit a bundle and watch every commitment stage live.
        </p>
      </header>

      <Card className="space-y-4">
        <div className="flex gap-2">
          <button onClick={() => setMode("probe")} className={tab(mode === "probe")}>
            Probe
          </button>
          <button
            onClick={() => setMode("transfer")}
            className={tab(mode === "transfer")}
          >
            Transfer
          </button>
        </div>

        {mode === "transfer" && (
          <div className="grid grid-cols-3 gap-3">
            <Input
              className="col-span-2"
              placeholder="recipient pubkey"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <Input
              placeholder="lamports"
              value={lamports}
              onChange={(e) => setLamports(e.target.value)}
            />
          </div>
        )}

        <Button onClick={run} disabled={running}>
          {running ? "Submitting…" : "Submit bundle"}
        </Button>

        {mode === "transfer" && (
          <p className="text-xs text-amber-400">
            Real mainnet transfer — this spends SOL.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-neutral-300">Lifecycle</h2>
        <Timeline events={events} />
      </Card>
    </div>
  );
}
