import type { Cadence } from "../db/schema";
import { addDays, addMonths, daysBetween } from "../time";

export type CadenceLike = { cadence: Cadence; intervalDays: number | null; anchorOn: string };
export type RecurringStatus = "paid" | "due" | "overdue";

/** A period opens this many days before its due date, so an early payment still counts. */
export const PERIOD_LEAD_DAYS = 7;

export function intervalDaysOf(c: CadenceLike): number | null {
  if (c.cadence === "weekly") return 7;
  if (c.cadence === "biweekly") return 14;
  if (c.cadence === "custom_days") return c.intervalDays;
  return null;
}

function approxPeriodDays(c: CadenceLike): number {
  if (c.cadence === "monthly") return 365.25 / 12;
  if (c.cadence === "yearly") return 365.25;
  return intervalDaysOf(c) ?? 30;
}

/** The k-th due date counted from the anchor (k may be negative). Month-based cadences are computed from the anchor, never chained, so clamping does not drift. */
export function dueAt(c: CadenceLike, k: number): string {
  if (c.cadence === "monthly") return addMonths(c.anchorOn, k);
  if (c.cadence === "yearly") return addMonths(c.anchorOn, 12 * k);
  const days = intervalDaysOf(c);
  if (!days || days <= 0) throw new Error(`recurring cost has no usable interval (${c.cadence})`);
  return addDays(c.anchorOn, k * days);
}

/** Index k whose period contains `today`: due(k) − lead ≤ today < due(k+1) − lead. */
export function currentIndex(c: CadenceLike, today: string): number {
  let k = Math.floor(daysBetween(c.anchorOn, today) / approxPeriodDays(c));
  while (daysBetween(dueAt(c, k), today) < -PERIOD_LEAD_DAYS) k--;
  while (daysBetween(dueAt(c, k + 1), today) >= -PERIOD_LEAD_DAYS) k++;
  return k;
}

export function currentDue(c: CadenceLike, today: string): string {
  return dueAt(c, currentIndex(c, today));
}

export function periodWindow(c: CadenceLike, k: number): { start: string; endExclusive: string } {
  return { start: addDays(dueAt(c, k), -PERIOD_LEAD_DAYS), endExclusive: addDays(dueAt(c, k + 1), -PERIOD_LEAD_DAYS) };
}

/** Due dates with fromDate ≤ due ≤ toDate, ascending. */
export function projectDueDates(c: CadenceLike, fromDate: string, toDate: string): string[] {
  if (toDate < fromDate) return [];
  let k = Math.floor(daysBetween(c.anchorOn, fromDate) / approxPeriodDays(c)) - 1;
  while (dueAt(c, k) >= fromDate) k--;
  while (dueAt(c, k + 1) < fromDate) k++;
  const out: string[] = [];
  for (k = k + 1; dueAt(c, k) <= toDate; k++) out.push(dueAt(c, k));
  return out;
}

/** The due index closest to `date`; an exact tie goes to the later due date. */
export function nearestDueIndex(c: CadenceLike, date: string): number {
  const k0 = Math.floor(daysBetween(c.anchorOn, date) / approxPeriodDays(c));
  let best = k0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const k of [k0 - 1, k0, k0 + 1, k0 + 2]) {
    const dist = Math.abs(daysBetween(dueAt(c, k), date));
    if (dist < bestDist || (dist === bestDist && k > best)) {
      best = k;
      bestDist = dist;
    }
  }
  return best;
}

export function recurringStatus(due: string, today: string, paid: boolean): RecurringStatus {
  if (paid) return "paid";
  return today <= due ? "due" : "overdue";
}

export function monthlyEquivalentCents(amountCents: number, c: CadenceLike): number {
  switch (c.cadence) {
    case "weekly":
      return Math.round((amountCents * 52) / 12);
    case "biweekly":
      return Math.round((amountCents * 26) / 12);
    case "monthly":
      return amountCents;
    case "yearly":
      return Math.round(amountCents / 12);
    case "custom_days": {
      const days = c.intervalDays ?? 30;
      return Math.round((amountCents * (365.25 / days)) / 12);
    }
  }
}
