import type { Db } from "../db/client";
import { listAccounts, totalsByCurrency, displayName } from "../queries/accounts";
import { getSyncStatus } from "../queries/syncRuns";
import { spendingByCategory, spendingByPeriod, topPayees } from "../queries/spending";
import { addDays, todayLocal, parseMonthKey, monthKey } from "../time";
import { totalsRemainingByCurrency, upcomingDebts, type UpcomingDebt } from "../queries/debts";
import { upcomingRecurring, type UpcomingRecurring } from "../queries/recurring";
import { budgetMonth } from "../budget/month";

export type SummaryPayload = {
  generatedAt: string;
  lastSync: { finishedAt: string | null; status: string } | null;
  credentialsInvalid: boolean;
  totals: { currency: string; balanceCents: number }[];
  accounts: { id: string; name: string; type: string | null; currency: string; balanceCents: number; balanceDate: number }[];
  debts: { remaining: { currency: string; remainingCents: number }[]; open: number };
  budget: { month: string; totals: { currency: string; capCents: number; spentCents: number }[] };
};

export function buildSummary(db: Db, opts: { tz: string; nowMs?: number }): SummaryPayload {
  const nowMs = opts.nowMs ?? Date.now();
  const today = todayLocal(opts.tz, nowMs);
  const { year, month } = parseMonthKey(monthKey(today))!;
  const status = getSyncStatus(db);
  const debtTotals = totalsRemainingByCurrency(db);
  const b = budgetMonth(db, { year, month, tz: opts.tz, today });
  return {
    generatedAt: new Date(nowMs).toISOString(),
    lastSync: status.latest ? { finishedAt: status.latest.finishedAt, status: status.latest.status } : null,
    credentialsInvalid: Boolean(status.credentialsInvalid),
    totals: totalsByCurrency(db),
    accounts: listAccounts(db).map((a) => ({ id: a.id, name: displayName(a), type: a.type, currency: a.currency, balanceCents: a.balanceCents, balanceDate: a.balanceDate })),
    debts: { remaining: debtTotals.map(({ currency, remainingCents }) => ({ currency, remainingCents })), open: debtTotals.reduce((n, t) => n + t.open, 0) },
    budget: { month: b.key, totals: b.totals },
  };
}

export const UPCOMING_MAX_DAYS = 60;
export const UPCOMING_DEFAULT_DAYS = 7;
export type UpcomingItem = UpcomingRecurring | UpcomingDebt;
export type UpcomingPayload = { generatedAt: string; today: string; days: number; items: UpcomingItem[] };

export function buildUpcoming(db: Db, opts: { tz: string; days: number; nowMs?: number }): UpcomingPayload {
  const nowMs = opts.nowMs ?? Date.now();
  const today = todayLocal(opts.tz, nowMs);
  const items: UpcomingItem[] = [...upcomingRecurring(db, { today, days: opts.days }), ...upcomingDebts(db, { today, days: opts.days })];
  items.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.name.localeCompare(b.name)));
  return { generatedAt: new Date(nowMs).toISOString(), today, days: opts.days, items };
}

export type SpendingRange = "today" | "7d" | "30d";
export const SPENDING_RANGES: SpendingRange[] = ["today", "7d", "30d"];
/**
 * One row per local calendar day (in the configured timezone) *per currency*: a multi-currency
 * owner cannot be served by a single top-level currency code, and the field is a `YYYY-MM-DD`
 * date because this endpoint is always day-granular — `spendingByPeriod`'s generic `period` name
 * does not belong in a published contract. This is the shape the README documents.
 */
export type SpendingDay = { date: string; currency: string; outflowCents: number; inflowCents: number };
export type SpendingCategory = { categoryId: number | null; name: string; currency: string; outflowCents: number };
export type SpendingPayload = { range: SpendingRange; days: SpendingDay[]; topPayees: ReturnType<typeof topPayees>; byCategory: SpendingCategory[] };

export function buildSpending(db: Db, range: SpendingRange, opts: { tz: string; nowMs?: number }): SpendingPayload {
  const nowMs = opts.nowMs ?? Date.now();
  const today = todayLocal(opts.tz, nowMs);
  const dayCount = range === "today" ? 1 : range === "7d" ? 7 : 30;
  // "today" must align to the local calendar day (matching the `days` filter below), not a
  // rolling 24h window, so topPayees and byCategory get an explicit since-date cutoff.
  const sinceDate = range === "today" ? today : addDays(today, -dayCount);
  const rows = spendingByPeriod(db, { days: dayCount, granularity: "day", today });
  const filtered = range === "today" ? rows.filter((r) => r.period === today) : rows;
  const days = filtered.map((r) => ({ date: r.period, currency: r.currency, outflowCents: r.outflowCents, inflowCents: r.inflowCents }));
  return {
    range,
    days,
    topPayees: topPayees(db, { days: dayCount, today, limit: 10, sinceDate }),
    byCategory: spendingByCategory(db, { sinceDate }).map(({ categoryId, name, currency, outflowCents }) => ({ categoryId, name, currency, outflowCents })),
  };
}
