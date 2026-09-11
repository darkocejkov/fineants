import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { authorise, unauthorised } from "@/lib/api/auth";
import { withApiErrors } from "@/lib/api/handler";
import { buildUpcoming, UPCOMING_DEFAULT_DAYS, UPCOMING_MAX_DAYS } from "@/lib/api/summary";

export const dynamic = "force-dynamic";

export const GET = withApiErrors(async (req: Request) => {
  const config = loadConfig();
  const auth = authorise(req, config);
  if (!auth.ok) return unauthorised(auth);
  const raw = new URL(req.url).searchParams.get("days");
  let days = UPCOMING_DEFAULT_DAYS;
  if (raw !== null) {
    if (!/^\d+$/.test(raw)) return Response.json({ error: `days must be a whole number from 1 to ${UPCOMING_MAX_DAYS}` }, { status: 400 });
    days = Number(raw);
    if (days < 1 || days > UPCOMING_MAX_DAYS) return Response.json({ error: `days must be a whole number from 1 to ${UPCOMING_MAX_DAYS}` }, { status: 400 });
  }
  return Response.json(buildUpcoming(getDb(), { tz: config.timezone, days }));
});
