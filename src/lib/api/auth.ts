import { timingSafeEqual } from "node:crypto";
import type { Config } from "../config";

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
  if (!config.apiKey) return { ok: false, status: 503, message: "API_KEY is not configured on the server" };
  const provided = req.headers.get("x-api-key");
  if (provided && safeEqual(provided, config.apiKey)) return { ok: true, via: "api-key" };
  return { ok: false, status: 401, message: "missing or invalid x-api-key" };
}

export function unauthorised(r: Extract<AuthResult, { ok: false }>): Response {
  return Response.json({ error: r.message }, { status: r.status });
}
