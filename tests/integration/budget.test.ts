import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic, seedTransferPair } from "../helpers/seed";
import type { Db } from "@/lib/db/client";
import { createCategory, updateCategory } from "@/lib/queries/categories";
import { setCategory, setTransfer } from "@/lib/queries/meta";
import { budgetMonth, budgetMonthRange } from "@/lib/budget/month";

let db: Db;
let groceries: number;
let dining: number;
let income: number;
beforeEach(() => {
  db = makeTestDb();
  seedBasic(db);
  groceries = createCategory(db, { name: "Groceries", kind: "expense" }).id;
  dining = createCategory(db, { name: "Dining", kind: "expense" }).id;
  income = createCategory(db, { name: "Income", kind: "income" }).id;
  updateCategory(db, groceries, { monthlyCapCents: 10000, capCurrency: "CAD" });
  setCategory(db, "t1", groceries); // -4510 on 2026-09-08
  setCategory(db, "t2", dining); // -1200 on 2026-09-07
  setCategory(db, "t3", income); // +250000 on 2026-09-06
});
const TZ = "America/Toronto";

describe("budgetMonth", () => {
  it("reports caps, spend, pace, uncapped, uncategorised, income, totals", () => {
    const b = budgetMonth(db, { year: 2026, month: 9, tz: TZ, today: "2026-09-09" });
    expect(b).toMatchObject({ key: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30", daysInMonth: 30, daysElapsed: 9 });
    expect(b.capped).toEqual([{ categoryId: groceries, name: "Groceries", currency: "CAD", capCents: 10000, spentCents: 4510, remainingCents: 5490, paceCents: 3000, paceState: "over_pace" }]);
    expect(b.uncapped).toEqual([{ categoryId: dining, name: "Dining", currency: "CAD", spentCents: 1200 }]);
    // t7 pending snack (-500, 09-09, CAD) and t8 USD thing (-1000, 09-04, USD) are uncategorised this month;
    // t4 gas (-8000, 08-30) is out of month.
    expect(b.uncategorised).toEqual([
      { currency: "CAD", spentCents: 500, count: 1 },
      { currency: "USD", spentCents: 1000, count: 1 },
    ]);
    expect(b.income).toEqual([{ categoryId: income, name: "Income", currency: "CAD", inflowCents: 250000 }]);
    expect(b.totals).toEqual([{ currency: "CAD", capCents: 10000, spentCents: 4510 }]);
  });
  it("pace states", () => {
    updateCategory(db, groceries, { monthlyCapCents: 4000, capCurrency: "CAD" });
    expect(budgetMonth(db, { year: 2026, month: 9, tz: TZ, today: "2026-09-09" }).capped[0].paceState).toBe("over_cap");
    updateCategory(db, groceries, { monthlyCapCents: 20000, capCurrency: "CAD" });
    expect(budgetMonth(db, { year: 2026, month: 9, tz: TZ, today: "2026-09-09" }).capped[0].paceState).toBe("on_pace"); // pace 6000 ≥ 4510
  });
  it("past months use the full month for pace; future months have zero days elapsed", () => {
    expect(budgetMonth(db, { year: 2026, month: 8, tz: TZ, today: "2026-09-09" }).daysElapsed).toBe(31);
    expect(budgetMonth(db, { year: 2026, month: 10, tz: TZ, today: "2026-09-09" }).daysElapsed).toBe(0);
  });
  it("excludes transfers and hidden accounts", () => {
    seedTransferPair(db);
    setTransfer(db, "xfer-out", true);
    const b = budgetMonth(db, { year: 2026, month: 9, tz: TZ, today: "2026-09-09" });
    // xfer-out (-75000) and t6 (hidden) absent; t8 (USD, uncategorised) still present.
    expect(b.uncategorised).toEqual([
      { currency: "CAD", spentCents: 500, count: 1 },
      { currency: "USD", spentCents: 1000, count: 1 },
    ]);
  });
  it("month range", () => {
    expect(budgetMonthRange(db, "2026-09-09")).toEqual({ earliest: "2026-07", latest: "2026-09" }); // t5 is 2026-07-31
    expect(budgetMonthRange(makeTestDb(), "2026-09-09")).toEqual({ earliest: "2026-09", latest: "2026-09" });
  });
});
