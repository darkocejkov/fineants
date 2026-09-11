import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, categories, transactionMeta, transactions } from "../db/schema";
import { notTransfer } from "./transactions";
import { addDays } from "../time";

export type Granularity = "day" | "week" | "month";
export type PeriodTotals = { period: string; currency: string; outflowCents: number; inflowCents: number };

function periodExpr(g: Granularity) {
  if (g === "day") return sql<string>`${transactions.localDate}`;
  if (g === "month") return sql<string>`substr(${transactions.localDate}, 1, 7)`;
  return sql<string>`strftime('%G-W%V', ${transactions.localDate})`;
}

const outflow = sql<number>`sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end)`.mapWith(Number);
const inflow = sql<number>`sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end)`.mapWith(Number);

/** Non-hidden, non-transfer rows on or after `sinceDate` (and before `untilDate` when given). */
function baseWhere(sinceDate: string, untilDate?: string) {
  return and(
    eq(accounts.hidden, false),
    notTransfer,
    gte(transactions.localDate, sinceDate),
    untilDate ? lt(transactions.localDate, untilDate) : undefined,
  );
}

export function spendingByPeriod(db: Db, opts: { days: number; granularity: Granularity; today: string }): PeriodTotals[] {
  const since = addDays(opts.today, -opts.days);
  const period = periodExpr(opts.granularity);
  return db
    .select({ period, currency: accounts.currency, outflowCents: outflow, inflowCents: inflow })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(transactionMeta, eq(transactionMeta.transactionId, transactions.id))
    .where(baseWhere(since))
    .groupBy(period, accounts.currency)
    .orderBy(accounts.currency, period)
    .all();
}

export function topPayees(db: Db, opts: { days: number; today: string; limit?: number; sinceDate?: string }): { label: string; currency: string; outflowCents: number; count: number }[] {
  const since = opts.sinceDate ?? addDays(opts.today, -opts.days);
  const limit = opts.limit ?? 10;
  const label = sql<string>`coalesce(nullif(${transactions.payee}, ''), ${transactions.description})`;
  const outflowCents = sql<number>`sum(-${transactions.amountCents})`.mapWith(Number);
  const rows = db
    .select({ label, currency: accounts.currency, outflowCents, count: sql<number>`count(*)`.mapWith(Number) })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(transactionMeta, eq(transactionMeta.transactionId, transactions.id))
    .where(and(baseWhere(since), sql`${transactions.amountCents} < 0`))
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

export function spendingByCategory(db: Db, opts: { sinceDate: string; untilDate?: string }): { categoryId: number | null; name: string; currency: string; outflowCents: number; count: number }[] {
  const outflowCents = sql<number>`sum(-${transactions.amountCents})`.mapWith(Number);
  return db
    .select({
      categoryId: transactionMeta.categoryId,
      name: sql<string>`coalesce(${categories.name}, 'Uncategorised')`,
      currency: accounts.currency,
      outflowCents,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(transactionMeta, eq(transactionMeta.transactionId, transactions.id))
    .leftJoin(categories, eq(categories.id, transactionMeta.categoryId))
    .where(and(baseWhere(opts.sinceDate, opts.untilDate), sql`${transactions.amountCents} < 0`))
    .groupBy(transactionMeta.categoryId, accounts.currency)
    .orderBy(accounts.currency, desc(outflowCents))
    .all()
    .map((r) => ({ ...r, categoryId: r.categoryId ?? null }));
}
