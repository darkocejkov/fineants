import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { authorise, unauthorised } from "@/lib/api/auth";
import { buildSpending, SPENDING_RANGES, type SpendingRange } from "@/lib/api/summary";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = authorise(req, loadConfig());
  if (!auth.ok) return unauthorised(auth);
  const range = new URL(req.url).searchParams.get("range") ?? "7d";
  if (!SPENDING_RANGES.includes(range as SpendingRange)) {
    return Response.json({ error: `range must be one of ${SPENDING_RANGES.join(", ")}` }, { status: 400 });
  }
  return Response.json(buildSpending(getDb(), range as SpendingRange));
}
