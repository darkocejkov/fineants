import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { authorise, unauthorised } from "@/lib/api/auth";
import { withApiErrors } from "@/lib/api/handler";
import { buildSummary } from "@/lib/api/summary";

export const dynamic = "force-dynamic";

export const GET = withApiErrors(async (req: Request) => {
  const auth = authorise(req, loadConfig());
  if (!auth.ok) return unauthorised(auth);
  return Response.json(buildSummary(getDb()));
});
