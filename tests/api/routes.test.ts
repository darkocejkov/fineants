import { describe, it, expect } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic, T0 } from "../helpers/seed";
import { buildSummary, buildSpending } from "@/lib/api/summary";
import { transactions } from "@/lib/db/schema";

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

  it("keeps today's payees aligned to the UTC calendar day, not a rolling 24h window", () => {
    const db = makeTestDb();
    seedBasic(db);
    // T0 is 2026-09-09T12:00Z; 23 hours earlier is 2026-09-08T13:00Z — within a rolling 24h
    // window but on the previous UTC calendar day.
    const yesterdayMs = T0 - 23 * 60 * 60 * 1000;
    const yesterdaySec = Math.floor(yesterdayMs / 1000);
    db.insert(transactions)
      .values({
        id: "t-yesterday",
        accountId: "CHQ",
        posted: yesterdaySec,
        transactedAt: null,
        amountCents: -700,
        description: "LATE NIGHT SNACK",
        payee: "Night Owl",
        memo: null,
        pending: false,
        raw: "{}",
        firstSeenAt: new Date(yesterdayMs).toISOString(),
        lastSeenAt: new Date(T0).toISOString(),
      })
      .run();

    expect(buildSpending(db, "today", T0).topPayees.some((p) => p.label === "Night Owl")).toBe(false);
    expect(buildSpending(db, "7d", T0).topPayees.some((p) => p.label === "Night Owl")).toBe(true);
  });
});
