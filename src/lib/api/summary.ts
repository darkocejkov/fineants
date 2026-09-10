import type { Db } from "../db/client";
import { listAccounts, totalsByCurrency, displayName } from "../queries/accounts";
import { getSyncStatus } from "../queries/syncRuns";
import { spendingByPeriod, topPayees } from "../queries/spending";

export type SummaryPayload = {
  generatedAt: string;
  lastSync: { finishedAt: string | null; status: string } | null;
  credentialsInvalid: boolean;
  totals: { currency: string; balanceCents: number }[];
  accounts: { id: string; name: string; type: string | null; currency: string; balanceCents: number; balanceDate: number }[];
};

export function buildSummary(db: Db, nowMs = Date.now()): SummaryPayload {
  const status = getSyncStatus(db);
  return {
    generatedAt: new Date(nowMs).toISOString(),
    lastSync: status.latest ? { finishedAt: status.latest.finishedAt, status: status.latest.status } : null,
    credentialsInvalid: Boolean(status.credentialsInvalid),
    totals: totalsByCurrency(db),
    accounts: listAccounts(db).map((a) => ({ id: a.id, name: displayName(a), type: a.type, currency: a.currency, balanceCents: a.balanceCents, balanceDate: a.balanceDate })),
  };
}

export type SpendingRange = "today" | "7d" | "30d";
export const SPENDING_RANGES: SpendingRange[] = ["today", "7d", "30d"];
/**
 * One row per UTC calendar day *per currency*: a multi-currency owner cannot be served by a
 * single top-level currency code, and the field is a `YYYY-MM-DD` date because this endpoint
 * is always day-granular — `spendingByPeriod`'s generic `period` name does not belong in a
 * published contract. This is the shape the README documents.
 */
export type SpendingDay = { date: string; currency: string; outflowCents: number; inflowCents: number };
export type SpendingPayload = { range: SpendingRange; days: SpendingDay[]; topPayees: ReturnType<typeof topPayees> };

export function buildSpending(db: Db, range: SpendingRange, nowMs = Date.now()): SpendingPayload {
  const dayCount = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const rows = spendingByPeriod(db, { days: dayCount, granularity: "day", nowMs });
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const filtered = range === "today" ? rows.filter((r) => r.period === todayStr) : rows;
  const days = filtered.map((r) => ({ date: r.period, currency: r.currency, outflowCents: r.outflowCents, inflowCents: r.inflowCents }));
  // "today" must align to the UTC calendar day (matching the `days` filter above), not a
  // rolling 24h window, so topPayees gets an explicit start-of-day cutoff for that range.
  let sinceSec: number | undefined;
  if (range === "today") {
    const d = new Date(nowMs);
    sinceSec = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
  }
  return { range, days, topPayees: topPayees(db, { days: dayCount, limit: 10, nowMs, sinceSec }) };
}
