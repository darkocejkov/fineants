import { describe, it, expect } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic, T0 } from "../helpers/seed";
import { buildSummary, buildSpending } from "@/lib/api/summary";

describe("buildSummary", () => {
  it("returns totals, visible accounts, and last sync", () => {
    const db = makeTestDb();
    seedBasic(db);
    const s = buildSummary(db, T0);
    expect(s.totals).toEqual([{ currency: "CAD", balanceCents: 50000 }, { currency: "USD", balanceCents: 250000 }]);
    expect(s.accounts.map((a) => a.id)).toEqual(["CHQ", "USD", "VISA"]);
    expect(s.accounts[2]).toMatchObject({ name: "Visa", type: "credit", balanceCents: -50000 });
    expect(s.lastSync?.status).toBe("success");
    expect(s.credentialsInvalid).toBe(false);
    expect(s.generatedAt).toBe(new Date(T0).toISOString());
  });
  it("handles an empty database", () => {
    const s = buildSummary(makeTestDb(), T0);
    expect(s).toMatchObject({ totals: [], accounts: [], lastSync: null });
  });
});

describe("buildSpending", () => {
  it("maps ranges to day windows", () => {
    const db = makeTestDb();
    seedBasic(db);
    expect(buildSpending(db, "today", T0).days.filter((d) => d.currency === "CAD")).toEqual([{ period: "2026-09-09", currency: "CAD", outflowCents: 500, inflowCents: 0 }]);
    expect(buildSpending(db, "7d", T0).days.filter((d) => d.currency === "CAD")).toHaveLength(4);
    expect(buildSpending(db, "30d", T0).topPayees[0].label).toBe("Gas");
  });
});
