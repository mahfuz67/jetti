import { getJetti } from "@/server/jetti";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { signature } = (await req.json()) as { signature: string };
  const jetti = await getJetti();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        const result = await jetti.track(signature, 60_000, (stage, slot, at) =>
          send({ type: stage, slot, at }),
        );
        send({ type: "result", landed: result.landed, landedSlot: result.landedSlot });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
