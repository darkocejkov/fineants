import { loadConfig, requireAccessUrl, type Config } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { authorise, unauthorised } from "@/lib/api/auth";
import { withApiErrors } from "@/lib/api/handler";
import { runSync } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

export const POST = withApiErrors(async (req: Request) => {
  const config = loadConfig();
  const auth = authorise(req, config, { allowSameOrigin: true });
  if (!auth.ok) return unauthorised(auth);
  const force = new URL(req.url).searchParams.get("force") === "1";
  const result = await runSync({ db: getDb(), accessUrl: config.simplefinAccessUrl, backfillDays: config.backfillDays, timezone: config.timezone }, { trigger: "manual", force });
  if (result.skipped === "rate_limited") return Response.json(result, { status: 409 });
  if (result.skipped === "credentials_invalid") return Response.json(result, { status: 503 });
  if (result.skipped === "no_access_url") {
    // The token stays in the body — the Sync now button maps it to its own sentence — and
    // requireAccessUrl's message rides along for every other client, which has none.
    return Response.json({ ...result, message: accessUrlMessage(config) }, { status: 503 });
  }
  return Response.json(result);
});

/** The claim-step instructions, as a string rather than the throw requireAccessUrl is built on. */
function accessUrlMessage(config: Config): string | undefined {
  try {
    requireAccessUrl(config);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : undefined;
  }
}
