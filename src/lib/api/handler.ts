import { ConfigError } from "../config";

/**
 * The one try/catch every route handler shares.
 *
 * A `ConfigError` is the operator's own misconfiguration, so its message — which is written
 * to be actionable — is returned as-is. Anything else is a defect: the client gets nothing
 * but "internal error", while the server log gets the message so the defect is diagnosable.
 * Only the message, never the error's request context: the headers carry the API key and the
 * access URL carries the SimpleFin credentials, and neither belongs in a log line.
 */
export function withApiErrors(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof ConfigError) return Response.json({ error: err.message }, { status: 500 });
      console.error("[fineants api]", err instanceof Error ? err.message : err);
      return Response.json({ error: "internal error" }, { status: 500 });
    }
  };
}
