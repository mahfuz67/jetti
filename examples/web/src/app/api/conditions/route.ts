import { getJetti } from "@/server/jetti";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jetti = await getJetti();
  const conditions = await jetti.conditions();
  return Response.json(conditions);
}
