import type { Db } from "../db/client";
import { listAccounts, totalsByCurrency, displayName } from "../queries/accounts";
import { getSyncStatus } from "../queries/syncRuns";
import { spendingByPeriod, topPayees, type PeriodTotals } from "../queries/spending";

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
export type SpendingPayload = { range: SpendingRange; days: PeriodTotals[]; topPayees: ReturnType<typeof topPayees> };

export function buildSpending(db: Db, range: SpendingRange, nowMs = Date.now()): SpendingPayload {
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const rows = spendingByPeriod(db, { days, granularity: "day", nowMs });
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const filtered = range === "today" ? rows.filter((r) => r.period === todayStr) : rows;
  return { range, days: filtered, topPayees: topPayees(db, { days, limit: 10, nowMs }) };
}
