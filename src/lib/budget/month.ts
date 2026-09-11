import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, categories, transactionMeta, transactions } from "../db/schema";
import { notTransfer } from "../queries/transactions";
import { daysBetween, daysInMonth, monthBounds, monthKey } from "../time";

export type PaceState = "on_pace" | "over_pace" | "over_cap";
export const PACE_WORDS: Record<PaceState, string> = { on_pace: "on pace", over_pace: "ahead of pace", over_cap: "over" };

export type BudgetMonth = {
  year: number;
  month: number;
  key: string;
  startDate: string;
  endDate: string;
  daysInMonth: number;
  daysElapsed: number;
  capped: { categoryId: number; name: string; currency: string; capCents: number; spentCents: number; remainingCents: number; paceCents: number; paceState: PaceState }[];
  uncapped: { categoryId: number; name: string; currency: string; spentCents: number }[];
  uncategorised: { currency: string; spentCents: number; count: number }[];
  income: { categoryId: number; name: string; currency: string; inflowCents: number }[];
  totals: { currency: string; capCents: number; spentCents: number }[];
};

export function budgetMonth(db: Db, opts: { year: number; month: number; tz: string; today: string }): BudgetMonth {
  const b = monthBounds(opts.year, opts.month, opts.tz);
  const dim = daysInMonth(opts.year, opts.month);
  const daysElapsed = opts.today < b.startDate ? 0 : opts.today > b.endDate ? dim : daysBetween(b.startDate, opts.today) + 1;

  const inMonth = and(eq(accounts.hidden, false), notTransfer, gte(transactions.localDate, b.startDate), lte(transactions.localDate, b.endDate));
  const outflow = sql<number>`sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end)`.mapWith(Number);
  const inflow = sql<number>`sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end)`.mapWith(Number);
  const outCount = sql<number>`sum(case when ${transactions.amountCents} < 0 then 1 else 0 end)`.mapWith(Number);

  const sums = db
    .select({ categoryId: transactionMeta.categoryId, currency: accounts.currency, outflowCents: outflow, inflowCents: inflow, outCount })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(transactionMeta, eq(transactionMeta.transactionId, transactions.id))
    .where(inMonth)
    .groupBy(transactionMeta.categoryId, accounts.currency)
    .all();

  const cats = db.select().from(categories).orderBy(categories.sortOrder, categories.id).all();
  const capped: BudgetMonth["capped"] = [];
  const uncapped: BudgetMonth["uncapped"] = [];
  const income: BudgetMonth["income"] = [];
  const totals = new Map<string, { capCents: number; spentCents: number }>();

  for (const c of cats) {
    const rows = sums.filter((s) => s.categoryId === c.id);
    if (c.kind === "income") {
      for (const r of rows) if (r.inflowCents > 0) income.push({ categoryId: c.id, name: c.name, currency: r.currency, inflowCents: r.inflowCents });
      continue;
    }
    if (c.monthlyCapCents !== null && c.capCurrency) {
      const spent = rows.filter((r) => r.currency === c.capCurrency).reduce((n, r) => n + r.outflowCents, 0);
      const paceCents = Math.round((c.monthlyCapCents * daysElapsed) / dim);
      const paceState: PaceState = spent > c.monthlyCapCents ? "over_cap" : spent > paceCents ? "over_pace" : "on_pace";
      capped.push({ categoryId: c.id, name: c.name, currency: c.capCurrency, capCents: c.monthlyCapCents, spentCents: spent, remainingCents: c.monthlyCapCents - spent, paceCents, paceState });
      const t = totals.get(c.capCurrency) ?? { capCents: 0, spentCents: 0 };
      t.capCents += c.monthlyCapCents;
      t.spentCents += spent;
      totals.set(c.capCurrency, t);
      // Spend in other currencies under a capped category is still spend: list it as uncapped.
      for (const r of rows) if (r.currency !== c.capCurrency && r.outflowCents > 0) uncapped.push({ categoryId: c.id, name: c.name, currency: r.currency, spentCents: r.outflowCents });
    } else {
      for (const r of rows) if (r.outflowCents > 0) uncapped.push({ categoryId: c.id, name: c.name, currency: r.currency, spentCents: r.outflowCents });
    }
  }
  uncapped.sort((a, b) => a.currency.localeCompare(b.currency) || b.spentCents - a.spentCents);

  const uncategorised = sums
    .filter((s) => s.categoryId === null && s.outflowCents > 0)
    .map((s) => ({ currency: s.currency, spentCents: s.outflowCents, count: s.outCount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    year: opts.year,
    month: opts.month,
    key: monthKey(b.startDate),
    startDate: b.startDate,
    endDate: b.endDate,
    daysInMonth: dim,
    daysElapsed,
    capped,
    uncapped,
    uncategorised,
    income,
    totals: [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, t]) => ({ currency, ...t })),
  };
}

/** Navigable months: from the earliest transaction's month to the current month. */
export function budgetMonthRange(db: Db, today: string): { earliest: string; latest: string } {
  const row = db.select({ min: sql<string | null>`min(${transactions.localDate})` }).from(transactions).get();
  const latest = monthKey(today);
  const earliest = row?.min ? monthKey(row.min) : latest;
  return { earliest: earliest < latest ? earliest : latest, latest };
}
