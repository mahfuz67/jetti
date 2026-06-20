import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { BundlePayload } from "jetti";
import { getJetti } from "@/server/jetti";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SendBody {
  mode: "probe" | "transfer";
  to?: string;
  lamports?: number;
}

export async function POST(req: Request) {
  const body = (await req.json()) as SendBody;
  const jetti = await getJetti();
  const wallet = jetti.ctx.config.wallet;

  let payload: BundlePayload = { kind: "probe" };
  if (body.mode === "transfer" && body.to && body.lamports) {
    payload = {
      kind: "instructions",
      instructions: [
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new PublicKey(body.to),
          lamports: body.lamports,
        }),
      ],
      signers: [wallet],
    };
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        await jetti.send({ payload, maxAttempts: 3, onEvent: send });
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
