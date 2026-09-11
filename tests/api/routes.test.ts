import { describe, it, expect } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic, seedTransferPair, T0 } from "../helpers/seed";
import { seedDebts, seedRecurring } from "../helpers/seed2b";
import { buildSummary, buildSpending, buildUpcoming } from "@/lib/api/summary";
import { transactions } from "@/lib/db/schema";
import { setTransfer, setCategory } from "@/lib/queries/meta";
import { createCategory, updateCategory } from "@/lib/queries/categories";

describe("buildSummary", () => {
  it("returns totals, visible accounts, and last sync", () => {
    const db = makeTestDb();
    seedBasic(db);
    const s = buildSummary(db, { tz: "UTC", nowMs: T0 });
    expect(s.totals).toEqual([{ currency: "CAD", balanceCents: 50000 }, { currency: "USD", balanceCents: 250000 }]);
    expect(s.accounts.map((a) => a.id)).toEqual(["CHQ", "USD", "VISA"]);
    expect(s.accounts[2]).toMatchObject({ name: "Visa", type: "credit", balanceCents: -50000 });
    expect(s.lastSync?.status).toBe("success");
    expect(s.credentialsInvalid).toBe(false);
    expect(s.generatedAt).toBe(new Date(T0).toISOString());
  });
  it("handles an empty database", () => {
    const s = buildSummary(makeTestDb(), { tz: "UTC", nowMs: T0 });
    expect(s).toMatchObject({ totals: [], accounts: [], lastSync: null });
  });
});

describe("buildSummary phase 2", () => {
  it("adds debts and the budget month", () => {
    const db = makeTestDb();
    seedBasic(db);
    seedDebts(db);
    const g = createCategory(db, { name: "Groceries", kind: "expense" }).id;
    updateCategory(db, g, { monthlyCapCents: 10000, capCurrency: "CAD" });
    setCategory(db, "t1", g);
    const s = buildSummary(db, { tz: "UTC", nowMs: T0 });
    expect(s.debts).toEqual({ remaining: [{ currency: "CAD", remainingCents: 1530000 }], open: 2 });
    expect(s.budget).toEqual({ month: "2026-09", totals: [{ currency: "CAD", capCents: 10000, spentCents: 4510 }] });
  });
  it("empty database", () => {
    const s = buildSummary(makeTestDb(), { tz: "UTC", nowMs: T0 });
    expect(s.debts).toEqual({ remaining: [], open: 0 });
    expect(s.budget.totals).toEqual([]);
  });
});

describe("buildUpcoming", () => {
  it("merges recurring and debt items sorted by due date", () => {
    const db = makeTestDb();
    seedBasic(db);
    seedRecurring(db);
    seedDebts(db);
    const u = buildUpcoming(db, { tz: "UTC", days: 7, nowMs: T0 });
    expect(u.today).toBe("2026-09-09");
    expect(u.days).toBe(7);
    expect(u.items.map((i) => [i.kind, i.name, i.dueOn])).toEqual([
      ["recurring", "Rent", "2026-09-01"],
      ["recurring", "Spotify", "2026-09-05"],
      ["debt", "Couch", "2026-09-15"],
      ["debt", "Student loan", "2026-09-15"],
    ]);
    expect(Object.keys(u)).toEqual(["generatedAt", "today", "days", "items"]);
  });
});

describe("buildSpending", () => {
  it("maps ranges to day windows", () => {
    const db = makeTestDb();
    seedBasic(db);
    expect(buildSpending(db, "today", { tz: "UTC", nowMs: T0 }).days.filter((d) => d.currency === "CAD")).toEqual([{ date: "2026-09-09", currency: "CAD", outflowCents: 500, inflowCents: 0 }]);
    expect(buildSpending(db, "7d", { tz: "UTC", nowMs: T0 }).days.filter((d) => d.currency === "CAD")).toHaveLength(4);
    expect(buildSpending(db, "30d", { tz: "UTC", nowMs: T0 }).topPayees[0].label).toBe("Gas");
  });

  // The payload is a published contract (README, spec §11, phase 3's Magic Frame), so the
  // field *names* are asserted, not just the row count: `date`, not the query layer's `period`.
  it("names every day row's fields date, currency, outflowCents, inflowCents", () => {
    const db = makeTestDb();
    seedBasic(db);
    const payload = buildSpending(db, "7d", { tz: "UTC", nowMs: T0 });
    expect(Object.keys(payload)).toEqual(["range", "days", "topPayees", "byCategory"]);
    expect(payload.days.length).toBeGreaterThan(0);
    for (const day of payload.days) {
      expect(Object.keys(day).sort()).toEqual(["currency", "date", "inflowCents", "outflowCents"]);
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("keeps today's payees aligned to the local calendar day, not a rolling 24h window", () => {
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
        localDate: new Date(yesterdayMs).toISOString().slice(0, 10),
      })
      .run();

    expect(buildSpending(db, "today", { tz: "UTC", nowMs: T0 }).topPayees.some((p) => p.label === "Night Owl")).toBe(false);
    expect(buildSpending(db, "7d", { tz: "UTC", nowMs: T0 }).topPayees.some((p) => p.label === "Night Owl")).toBe(true);
  });

  it("includes byCategory and excludes transfers", () => {
    const db = makeTestDb();
    seedBasic(db);
    seedTransferPair(db);
    setTransfer(db, "xfer-out", true);
    const cat = createCategory(db, { name: "Groceries", kind: "expense" });
    setCategory(db, "t1", cat.id);
    const p = buildSpending(db, "30d", { tz: "UTC", nowMs: T0 });
    expect(Object.keys(p)).toEqual(["range", "days", "topPayees", "byCategory"]);
    expect(p.byCategory.find((c) => c.categoryId === cat.id)).toMatchObject({ name: "Groceries", currency: "CAD", outflowCents: 4510 });
    expect(p.days.find((d) => d.date === "2026-09-04" && d.currency === "CAD")).toBeUndefined();
  });
  it("'today' follows the timezone", () => {
    const db = makeTestDb();
    seedBasic(db);
    // 03:30Z on the 10th is still the 9th in Toronto.
    const late = Date.UTC(2026, 8, 10, 3, 30);
    expect(buildSpending(db, "today", { tz: "America/Toronto", nowMs: late }).days.filter((d) => d.currency === "CAD")).toHaveLength(1);
    expect(buildSpending(db, "today", { tz: "UTC", nowMs: late }).days.filter((d) => d.currency === "CAD")).toHaveLength(0);
  });
});
