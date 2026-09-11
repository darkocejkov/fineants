import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { authorise, unauthorised } from "@/lib/api/auth";
import { withApiErrors } from "@/lib/api/handler";
import { applyTagging } from "@/lib/tagging/apply";

export const dynamic = "force-dynamic";

export const POST = withApiErrors(async (req: Request) => {
  const config = loadConfig();
  const auth = authorise(req, config, { allowSameOrigin: true });
  if (!auth.ok) return unauthorised(auth);
  return Response.json(applyTagging(getDb()));
});
