import { describe, it, expect } from "vitest";
import { authorise } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";

const cfg = loadConfig({ API_KEY: "secret" });
const req = (headers: Record<string, string>) => new Request("http://localhost/api/x", { headers });

describe("authorise", () => {
  it("accepts a matching api key", () => {
    expect(authorise(req({ "x-api-key": "secret" }), cfg)).toEqual({ ok: true, via: "api-key" });
  });
  it("rejects a wrong or missing key", () => {
    expect(authorise(req({ "x-api-key": "nope" }), cfg).ok).toBe(false);
    expect(authorise(req({}), cfg).ok).toBe(false);
  });
  it("returns 503 when no API key is configured", () => {
    const r = authorise(req({ "x-api-key": "x" }), loadConfig({}));
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
  it("accepts same-origin only when allowed", () => {
    const so = req({ "sec-fetch-site": "same-origin" });
    expect(authorise(so, cfg, { allowSameOrigin: true })).toEqual({ ok: true, via: "same-origin" });
    expect(authorise(so, cfg).ok).toBe(false);
    expect(authorise(req({ "sec-fetch-site": "cross-site" }), cfg, { allowSameOrigin: true }).ok).toBe(false);
  });
});
