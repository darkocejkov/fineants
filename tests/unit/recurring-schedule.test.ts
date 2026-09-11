import { describe, it, expect } from "vitest";
import { dueAt, currentIndex, currentDue, periodWindow, projectDueDates, nearestDueIndex, recurringStatus, monthlyEquivalentCents, leadDaysOf, type CadenceLike } from "@/lib/recurring/schedule";

const monthly: CadenceLike = { cadence: "monthly", intervalDays: null, anchorOn: "2026-01-31" };
const weekly: CadenceLike = { cadence: "weekly", intervalDays: null, anchorOn: "2026-09-02" };
const biweekly: CadenceLike = { cadence: "biweekly", intervalDays: null, anchorOn: "2026-09-04" };
const yearly: CadenceLike = { cadence: "yearly", intervalDays: null, anchorOn: "2024-02-29" };
const custom: CadenceLike = { cadence: "custom_days", intervalDays: 45, anchorOn: "2026-01-01" };

describe("dueAt", () => {
  it("steps monthly from the anchor with month-end clamping, without drift", () => {
    expect(dueAt(monthly, 0)).toBe("2026-01-31");
    expect(dueAt(monthly, 1)).toBe("2026-02-28");
    expect(dueAt(monthly, 2)).toBe("2026-03-31"); // not 03-28: computed from the anchor, not chained
    expect(dueAt(monthly, -1)).toBe("2025-12-31");
  });
  it("steps weekly, biweekly, yearly, custom", () => {
    expect(dueAt(weekly, 3)).toBe("2026-09-23");
    expect(dueAt(biweekly, 1)).toBe("2026-09-18");
    expect(dueAt(yearly, 1)).toBe("2025-02-28");
    expect(dueAt(yearly, 4)).toBe("2028-02-29");
    expect(dueAt(custom, 2)).toBe("2026-04-01");
  });
});

describe("periods", () => {
  it("finds the period containing today with the cadence's lead", () => {
    // Due 2026-09-30 (k=8); its period runs 09-23 .. 10-23 (next due 10-31 minus 7).
    expect(currentDue(monthly, "2026-09-23")).toBe("2026-09-30");
    expect(currentDue(monthly, "2026-10-22")).toBe("2026-09-30");
    expect(currentDue(monthly, "2026-10-24")).toBe("2026-10-31");
    expect(currentDue(monthly, "2026-09-22")).toBe("2026-08-31");
    // Weekly's lead is half its period (3 days, via leadDaysOf), not the full 7, so due(0)="2026-09-02"
    // stays inside its own window [08-30, 09-06) instead of tipping into period 1's.
    expect(currentIndex(weekly, "2026-09-02")).toBe(0);
    expect(currentIndex(weekly, "2026-09-01")).toBe(0); // window 08-30 <= 09-01 < 09-06
    expect(currentIndex(weekly, "2026-08-25")).toBe(-1); // window 08-23 <= 08-25 < 08-30
  });
  it("gives the period window", () => {
    expect(periodWindow(monthly, 8)).toEqual({ start: "2026-09-23", endExclusive: "2026-10-24" });
    expect(periodWindow(weekly, 0)).toEqual({ start: "2026-08-30", endExclusive: "2026-09-06" });
  });
  it("computes the lead as half the period, capped at 7 days", () => {
    expect(leadDaysOf(weekly)).toBe(3);
    expect(leadDaysOf(biweekly)).toBe(7);
    expect(leadDaysOf(monthly)).toBe(7);
    expect(leadDaysOf(yearly)).toBe(7);
    expect(leadDaysOf(custom)).toBe(7);
    expect(leadDaysOf({ cadence: "custom_days", intervalDays: 10, anchorOn: "2026-01-01" })).toBe(5);
  });
  it("projects due dates inside a range, inclusive", () => {
    expect(projectDueDates(weekly, "2026-09-09", "2026-09-30")).toEqual(["2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"]);
    expect(projectDueDates(monthly, "2026-02-01", "2026-04-30")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(projectDueDates(weekly, "2026-09-10", "2026-09-15")).toEqual([]);
  });
  it("finds the nearest due index to a date", () => {
    expect(nearestDueIndex(monthly, "2026-09-14")).toBe(7); // 08-31 is 14 away, 09-30 is 16 away
    expect(nearestDueIndex(monthly, "2026-09-16")).toBe(8);
    expect(nearestDueIndex(weekly, "2026-09-05")).toBe(0);
    expect(nearestDueIndex(weekly, "2026-09-06")).toBe(1); // tie goes to the later due date
  });
});

describe("status and equivalents", () => {
  it("classifies paid, due, overdue", () => {
    expect(recurringStatus("2026-09-30", "2026-09-25", true)).toBe("paid");
    expect(recurringStatus("2026-09-30", "2026-09-25", false)).toBe("due");
    expect(recurringStatus("2026-09-30", "2026-09-30", false)).toBe("due");
    expect(recurringStatus("2026-09-30", "2026-10-01", false)).toBe("overdue");
  });
  it("normalises to a month", () => {
    expect(monthlyEquivalentCents(1200, monthly)).toBe(1200);
    expect(monthlyEquivalentCents(1000, weekly)).toBe(4333);
    expect(monthlyEquivalentCents(1000, biweekly)).toBe(2167);
    expect(monthlyEquivalentCents(12000, yearly)).toBe(1000);
    expect(monthlyEquivalentCents(4500, custom)).toBe(3044); // 4500 * (365.25/45) / 12 = 3043.75
  });
});
