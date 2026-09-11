import { describe, it, expect, vi, beforeEach } from "vitest";
import { seedBasic } from "../helpers/seed";

vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { ...actual, loadConfig: vi.fn() };
});

vi.mock("@/lib/sync/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sync/engine")>();
  return { ...actual, runSync: vi.fn() };
});

vi.mock("@/lib/tagging/apply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tagging/apply")>();
  return { ...actual, applyTagging: vi.fn() };
});

import { createDb, getDb } from "@/lib/db/client";
import { ConfigError, loadConfig } from "@/lib/config";
import { runSync } from "@/lib/sync/engine";
import { applyTagging } from "@/lib/tagging/apply";
import { POST } from "@/app/api/sync/route";
import { POST as tagPOST } from "@/app/api/tag/route";
import { GET as summaryGET } from "@/app/api/v1/summary/route";
import { GET as spendingGET } from "@/app/api/v1/spending/route";
import { GET as upcomingGET } from "@/app/api/v1/upcoming/route";

const baseConfig = { apiKey: "k", databasePath: ":memory:", syncIntervalHours: 6, backfillDays: 365, port: 3000, timezone: "America/Toronto" };

const req = (url: string, init?: RequestInit) => new Request(url, init);

describe("route handlers", () => {
  beforeEach(() => {
    const db = createDb(":memory:");
    seedBasic(db);
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(loadConfig).mockReturnValue(baseConfig);
    vi.mocked(runSync).mockReset();
  });

  describe("GET /api/v1/summary", () => {
    it("401 without key", async () => {
      const res = await summaryGET(req("http://localhost/api/v1/summary"));
      expect(res.status).toBe(401);
    });
    it("200 with key returns totals", async () => {
      const res = await summaryGET(req("http://localhost/api/v1/summary", { headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totals).toEqual([
        { currency: "CAD", balanceCents: 50000 },
        { currency: "USD", balanceCents: 250000 },
      ]);
    });
    it("500 with message when loadConfig throws a ConfigError", async () => {
      vi.mocked(loadConfig).mockImplementationOnce(() => {
        throw new ConfigError("Invalid environment: BACKFILL_DAYS");
      });
      const res = await summaryGET(req("http://localhost/api/v1/summary", { headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Invalid environment: BACKFILL_DAYS");
    });
  });

  describe("GET /api/v1/spending", () => {
    it("400 for range=1y", async () => {
      const res = await spendingGET(req("http://localhost/api/v1/spending?range=1y", { headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(400);
    });
    it("200 default range 7d", async () => {
      const res = await spendingGET(req("http://localhost/api/v1/spending", { headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.range).toBe("7d");
    });
  });

  describe("GET /api/v1/upcoming", () => {
    it("rejects without a key", async () => {
      vi.mocked(loadConfig).mockReturnValue(baseConfig);
      expect((await upcomingGET(req("http://x/api/v1/upcoming"))).status).toBe(401);
    });
    it("validates days", async () => {
      vi.mocked(loadConfig).mockReturnValue(baseConfig);
      vi.mocked(getDb).mockReturnValue(createDb(":memory:"));
      for (const bad of ["0", "61", "abc", "2.5"]) {
        const res = await upcomingGET(req(`http://x/api/v1/upcoming?days=${bad}`, { headers: { "x-api-key": "k" } }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "days must be a whole number from 1 to 60" });
      }
    });
    it("defaults to 7 days and returns the payload", async () => {
      vi.mocked(loadConfig).mockReturnValue(baseConfig);
      vi.mocked(getDb).mockReturnValue(createDb(":memory:"));
      const res = await upcomingGET(req("http://x/api/v1/upcoming", { headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ days: 7, items: [] });
    });
  });

  describe("POST /api/sync", () => {
    it("401 without key or same-origin", async () => {
      const res = await POST(req("http://localhost/api/sync", { method: "POST" }));
      expect(res.status).toBe(401);
    });
    it("200 same-origin, calls runSync with trigger manual and force false", async () => {
      vi.mocked(runSync).mockResolvedValueOnce({ runs: [] });
      const res = await POST(req("http://localhost/api/sync", { method: "POST", headers: { "sec-fetch-site": "same-origin" } }));
      expect(res.status).toBe(200);
      expect(runSync).toHaveBeenCalledWith(expect.anything(), { trigger: "manual", force: false });
    });
    it("?force=1 passes force: true", async () => {
      vi.mocked(runSync).mockResolvedValueOnce({ runs: [] });
      const res = await POST(req("http://localhost/api/sync?force=1", { method: "POST", headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(200);
      expect(runSync).toHaveBeenCalledWith(expect.anything(), { trigger: "manual", force: true });
    });
    it("409 when runSync reports rate_limited", async () => {
      vi.mocked(runSync).mockResolvedValueOnce({ skipped: "rate_limited", runs: [] });
      const res = await POST(req("http://localhost/api/sync", { method: "POST", headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(409);
    });
    it("503 when runSync reports credentials_invalid", async () => {
      vi.mocked(runSync).mockResolvedValueOnce({ skipped: "credentials_invalid", runs: [] });
      const res = await POST(req("http://localhost/api/sync", { method: "POST", headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(503);
    });
    it("503 with the claim instructions when the access URL is missing", async () => {
      vi.mocked(runSync).mockResolvedValueOnce({ skipped: "no_access_url", runs: [] });
      const res = await POST(req("http://localhost/api/sync", { method: "POST", headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.skipped).toBe("no_access_url");
      expect(body.message).toMatch(/npm run claim/);
    });
  });

  describe("POST /api/tag", () => {
    it("rejects without a key", async () => {
      vi.mocked(loadConfig).mockReturnValue(baseConfig);
      const res = await tagPOST(req("http://x/api/tag", { method: "POST" }));
      expect(res.status).toBe(401);
    });
    it("runs the pass and returns the report", async () => {
      vi.mocked(loadConfig).mockReturnValue(baseConfig);
      vi.mocked(getDb).mockReturnValue(createDb(":memory:"));
      vi.mocked(applyTagging).mockReturnValue({ categorised: 3, categoryCleared: 0, transfersPaired: 1, transfersCleared: 0, recurringMatched: 0, invalidRules: [], durationMs: 5, at: "x" });
      const res = await tagPOST(req("http://x/api/tag", { method: "POST", headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ categorised: 3, transfersPaired: 1 });
    });
    it("accepts same-origin without a key", async () => {
      vi.mocked(loadConfig).mockReturnValue(baseConfig);
      vi.mocked(getDb).mockReturnValue(createDb(":memory:"));
      vi.mocked(applyTagging).mockReturnValue({ categorised: 0, categoryCleared: 0, transfersPaired: 0, transfersCleared: 0, recurringMatched: 0, invalidRules: [], durationMs: 1, at: "x" });
      const res = await tagPOST(req("http://x/api/tag", { method: "POST", headers: { "sec-fetch-site": "same-origin" } }));
      expect(res.status).toBe(200);
    });
  });

  describe("an unexpected throw", () => {
    it("returns 500 'internal error' and logs the message, without the request or the URL", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(runSync).mockRejectedValueOnce(new Error("SQLITE_CORRUPT: database disk image is malformed"));
      const res = await POST(
        req("http://localhost/api/sync", { method: "POST", headers: { "x-api-key": "k", "x-secret": "leak-me" } }),
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal error" });
      expect(logged).toHaveBeenCalledWith("[fineants api]", "SQLITE_CORRUPT: database disk image is malformed");
      // One call, one message: no headers, no access URL, nothing else that could carry a secret.
      expect(logged.mock.calls).toHaveLength(1);
      expect(JSON.stringify(logged.mock.calls)).not.toContain("leak-me");
      logged.mockRestore();
    });
    it("a ConfigError keeps its own message and is not logged", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(loadConfig).mockImplementationOnce(() => {
        throw new ConfigError("Invalid environment:\nBACKFILL_DAYS: must be a non-negative integer");
      });
      const res = await spendingGET(req("http://localhost/api/v1/spending", { headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toMatch(/BACKFILL_DAYS/);
      expect(logged).not.toHaveBeenCalled();
      logged.mockRestore();
    });
  });
});
