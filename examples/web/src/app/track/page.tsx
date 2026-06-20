"use client";
import { useState } from "react";
import type { StreamEvent } from "@/lib/events";
import { streamEvents } from "@/lib/stream";
import { Timeline } from "@/components/Timeline";
import { Button, Card, Input } from "@/components/ui";

export default function TrackPage() {
  const [signature, setSignature] = useState("");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!signature) return;
    setEvents([]);
    setRunning(true);
    try {
      await streamEvents<StreamEvent>("/api/track", { signature }, (e) =>
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
        <h1 className="text-2xl font-semibold tracking-tight">Track</h1>
        <p className="text-sm text-neutral-400">
          Watch any signature advance across commitment stages from the stream.
        </p>
      </header>

      <Card className="space-y-4">
        <Input
          placeholder="transaction signature"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
        />
        <Button onClick={run} disabled={running || !signature}>
          {running ? "Watching…" : "Track"}
        </Button>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-neutral-300">Stages</h2>
        <Timeline events={events} />
      </Card>
    </div>
  );
}
