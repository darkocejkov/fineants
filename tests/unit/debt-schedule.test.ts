import { describe, it, expect } from "vitest";
import { remainingCents, projectedInstalments, nextDue, debtStatus, hasSchedule, type DebtLike, type PaymentLike } from "@/lib/debts/schedule";

const base: DebtLike = {
  principalCents: 40000, payoffDueOn: null, interestFreeUntil: null, dueDay: null,
  instalmentAmountCents: null, cadence: null, intervalDays: null, firstInstalmentOn: null, instalmentCount: null, closedAt: null,
};
const payIn4: DebtLike = { ...base, instalmentAmountCents: 10000, cadence: "biweekly", firstInstalmentOn: "2026-09-01", instalmentCount: 4 };
const deferred: DebtLike = { ...base, principalCents: 120000, interestFreeUntil: "2027-03-01", payoffDueOn: "2027-03-01" };
const loan: DebtLike = { ...base, principalCents: 1500000, dueDay: 15 };
const p = (paidOn: string, amountCents: number): PaymentLike => ({ paidOn, amountCents });

describe("remaining and schedule", () => {
  it("subtracts payments", () => {
    expect(remainingCents(payIn4, [])).toBe(40000);
    expect(remainingCents(payIn4, [p("2026-09-01", 10000), p("2026-09-15", 10000)])).toBe(20000);
    expect(remainingCents(payIn4, [p("2026-09-01", 50000)])).toBe(-10000);
  });
  it("projects a pay-in-4 and applies payments in order with spill-over", () => {
    expect(hasSchedule(payIn4)).toBe(true);
    const rows = projectedInstalments(payIn4, [p("2026-09-01", 15000)], "2026-09-20");
    expect(rows.map((r) => r.dueOn)).toEqual(["2026-09-01", "2026-09-15", "2026-09-29", "2026-10-13"]);
    expect(rows.map((r) => r.paidCents)).toEqual([10000, 5000, 0, 0]);
    expect(rows.map((r) => r.state)).toEqual(["paid", "partial", "due", "due"]);
  });
  it("marks unpaid past instalments overdue", () => {
    const rows = projectedInstalments(payIn4, [], "2026-09-16");
    expect(rows.map((r) => r.state)).toEqual(["overdue", "overdue", "due", "due"]);
  });
  it("open-ended schedule runs until the principal is covered", () => {
    const openEnded: DebtLike = { ...base, principalCents: 25000, instalmentAmountCents: 10000, cadence: "monthly", firstInstalmentOn: "2026-10-01", instalmentCount: null };
    const rows = projectedInstalments(openEnded, [], "2026-09-09");
    expect(rows.map((r) => r.amountCents)).toEqual([10000, 10000, 5000]);
  });
  it("has no schedule for deferred plans and loans", () => {
    expect(projectedInstalments(deferred, [], "2026-09-09")).toEqual([]);
    expect(projectedInstalments(loan, [], "2026-09-09")).toEqual([]);
  });
});

describe("nextDue", () => {
  it("is the first instalment not fully paid, or null when all are paid", () => {
    expect(nextDue(payIn4, [p("2026-09-01", 10000)], "2026-09-09")).toBe("2026-09-15");
    expect(nextDue(payIn4, [p("2026-09-01", 40000)], "2026-09-09")).toBeNull();
  });
  it("is the payoff date for deferred plans", () => {
    expect(nextDue(deferred, [], "2026-09-09")).toBe("2027-03-01");
  });
  it("is the next occurrence of due_day for open loans", () => {
    expect(nextDue(loan, [], "2026-09-09")).toBe("2026-09-15");
    expect(nextDue(loan, [], "2026-09-15")).toBe("2026-09-15");
    expect(nextDue(loan, [], "2026-09-16")).toBe("2026-10-15");
    expect(nextDue({ ...loan, dueDay: 31 }, [], "2026-02-10")).toBe("2026-02-28");
  });
  it("is null with nothing to go on", () => {
    expect(nextDue(base, [], "2026-09-09")).toBeNull();
  });
});

describe("debtStatus precedence", () => {
  it("paid_off beats everything", () => {
    expect(debtStatus(payIn4, [p("2026-09-01", 40000)], "2026-12-01")).toBe("paid_off");
    expect(debtStatus({ ...payIn4, closedAt: "2026-09-09T00:00:00Z" }, [], "2026-09-09")).toBe("paid_off");
  });
  it("overdue, then due_soon, then interest_starts_soon, then on_track", () => {
    expect(debtStatus(payIn4, [], "2026-09-02")).toBe("overdue");
    expect(debtStatus(payIn4, [], "2026-08-25")).toBe("due_soon");
    expect(debtStatus(payIn4, [], "2026-08-01")).toBe("on_track");
    expect(debtStatus(deferred, [], "2027-02-20")).toBe("due_soon"); // payoff within 14 days wins over interest
    expect(debtStatus(deferred, [], "2027-02-01")).toBe("interest_starts_soon");
    expect(debtStatus(deferred, [], "2026-09-09")).toBe("on_track");
    expect(debtStatus(deferred, [], "2027-03-02")).toBe("overdue");
  });
});
