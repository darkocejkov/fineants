import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, transactions } from "../db/schema";
import { effectiveDate } from "./transactions";

export type Granularity = "day" | "week" | "month";
export type PeriodTotals = { period: string; currency: string; outflowCents: number; inflowCents: number };

function periodExpr(g: Granularity) {
  const ts = sql`datetime(${effectiveDate}, 'unixepoch')`;
  if (g === "day") return sql<string>`strftime('%Y-%m-%d', ${ts})`;
  if (g === "month") return sql<string>`strftime('%Y-%m', ${ts})`;
  // ISO week (SQLite 3.46+ supports %G-W%V)
  return sql<string>`strftime('%G-W%V', ${ts})`;
}

const outflow = sql<number>`sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end)`.mapWith(Number);
const inflow = sql<number>`sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end)`.mapWith(Number);

export function spendingByPeriod(db: Db, opts: { days: number; granularity: Granularity; nowMs?: number }): PeriodTotals[] {
  const since = Math.floor((opts.nowMs ?? Date.now()) / 1000) - opts.days * 86400;
  const period = periodExpr(opts.granularity);
  return db
    .select({ period, currency: accounts.currency, outflowCents: outflow, inflowCents: inflow })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(accounts.hidden, false), gte(effectiveDate, since)))
    .groupBy(period, accounts.currency)
    .orderBy(accounts.currency, period)
    .all();
}

export function topPayees(db: Db, opts: { days: number; limit?: number; nowMs?: number }): { label: string; currency: string; outflowCents: number; count: number }[] {
  const since = Math.floor((opts.nowMs ?? Date.now()) / 1000) - opts.days * 86400;
  const limit = opts.limit ?? 10;
  const label = sql<string>`coalesce(nullif(${transactions.payee}, ''), ${transactions.description})`;
  const outflowCents = sql<number>`sum(-${transactions.amountCents})`.mapWith(Number);
  // Fetch all payees ranked within each currency (no SQL limit), then keep the top `limit`
  // rows per currency in TypeScript so ranking is per-currency rather than global.
  const rows = db
    .select({ label, currency: accounts.currency, outflowCents, count: sql<number>`count(*)`.mapWith(Number) })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(accounts.hidden, false), gte(effectiveDate, since), sql`${transactions.amountCents} < 0`))
    .groupBy(label, accounts.currency)
    .orderBy(accounts.currency, desc(outflowCents), label)
    .all();

  const perCurrencyCount = new Map<string, number>();
  const out: typeof rows = [];
  for (const r of rows) {
    const n = perCurrencyCount.get(r.currency) ?? 0;
    if (n >= limit) continue;
    perCurrencyCount.set(r.currency, n + 1);
    out.push(r);
  }
  return out;
}
