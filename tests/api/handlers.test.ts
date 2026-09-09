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

import { createDb, getDb } from "@/lib/db/client";
import { ConfigError, loadConfig } from "@/lib/config";
import { runSync } from "@/lib/sync/engine";
import { POST } from "@/app/api/sync/route";
import { GET as summaryGET } from "@/app/api/v1/summary/route";
import { GET as spendingGET } from "@/app/api/v1/spending/route";

const baseConfig = { apiKey: "k", databasePath: ":memory:", syncIntervalHours: 6, backfillDays: 365, port: 3000 };

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
  });
});
