import { timingSafeEqual } from "node:crypto";
import { requireApiKey, type Config } from "../config";

export type AuthResult =
  | { ok: true; via: "api-key" | "same-origin" }
  | { ok: false; status: 401 | 503; message: string };

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function authorise(req: Request, config: Config, opts: { allowSameOrigin?: boolean } = {}): AuthResult {
  if (opts.allowSameOrigin && req.headers.get("sec-fetch-site") === "same-origin") {
    return { ok: true, via: "same-origin" };
  }
  // requireApiKey owns spec §9's actionable sentence ("generate one with openssl rand -hex 32");
  // here it becomes a 503 body instead of a throw, so that message lives in exactly one place.
  let apiKey: string;
  try {
    apiKey = requireApiKey(config);
  } catch (err) {
    return { ok: false, status: 503, message: err instanceof Error ? err.message : String(err) };
  }
  const provided = req.headers.get("x-api-key");
  if (provided && safeEqual(provided, apiKey)) return { ok: true, via: "api-key" };
  return { ok: false, status: 401, message: "missing or invalid x-api-key" };
}

export function unauthorised(r: Extract<AuthResult, { ok: false }>): Response {
  return Response.json({ error: r.message }, { status: r.status });
}
