import { ConfigError, loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { authorise, unauthorised } from "@/lib/api/auth";
import { runSync } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const config = loadConfig();
    const auth = authorise(req, config, { allowSameOrigin: true });
    if (!auth.ok) return unauthorised(auth);
    const force = new URL(req.url).searchParams.get("force") === "1";
    const result = await runSync({ db: getDb(), accessUrl: config.simplefinAccessUrl, backfillDays: config.backfillDays }, { trigger: "manual", force });
    if (result.skipped === "rate_limited") return Response.json(result, { status: 409 });
    if (result.skipped === "credentials_invalid" || result.skipped === "no_access_url") return Response.json(result, { status: 503 });
    return Response.json(result);
  } catch (err) {
    if (err instanceof ConfigError) return Response.json({ error: err.message }, { status: 500 });
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
