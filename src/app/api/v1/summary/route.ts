import { ConfigError, loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { authorise, unauthorised } from "@/lib/api/auth";
import { buildSummary } from "@/lib/api/summary";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = authorise(req, loadConfig());
    if (!auth.ok) return unauthorised(auth);
    return Response.json(buildSummary(getDb()));
  } catch (err) {
    if (err instanceof ConfigError) return Response.json({ error: err.message }, { status: 500 });
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
