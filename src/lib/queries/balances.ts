import { and, eq, gte, asc, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, balanceSnapshots } from "../db/schema";

export type SeriesPoint = { date: string; balanceCents: number };

const dayOf = (iso: string) => iso.slice(0, 10);

function sinceIso(days: number, nowMs: number): string {
  return new Date(nowMs - days * 86400 * 1000).toISOString();
}

export function accountBalanceSeries(db: Db, accountId: string, days: number, nowMs = Date.now()): SeriesPoint[] {
  const rows = db
    .select({ recordedAt: balanceSnapshots.recordedAt, balanceCents: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.accountId, accountId), gte(balanceSnapshots.recordedAt, sinceIso(days, nowMs))))
    .orderBy(asc(balanceSnapshots.recordedAt))
    .all();
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(dayOf(r.recordedAt), r.balanceCents); // last write per day wins
  return [...byDay.entries()].map(([date, balanceCents]) => ({ date, balanceCents }));
}

export function netWorthSeries(db: Db, days: number, nowMs = Date.now()): { currency: string; points: SeriesPoint[] }[] {
  const visible = db.select({ id: accounts.id, currency: accounts.currency }).from(accounts).where(eq(accounts.hidden, false)).all();
  if (visible.length === 0) return [];
  const currencyOf = new Map(visible.map((a) => [a.id, a.currency]));
  const rows = db
    .select({ accountId: balanceSnapshots.accountId, recordedAt: balanceSnapshots.recordedAt, balanceCents: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(inArray(balanceSnapshots.accountId, visible.map((a) => a.id)), gte(balanceSnapshots.recordedAt, sinceIso(days, nowMs))))
    .orderBy(asc(balanceSnapshots.recordedAt))
    .all();

  // per currency: per day, per account last balance; then carry forward
  const perCurrency = new Map<string, Map<string, Map<string, number>>>(); // currency -> day -> account -> balance
  for (const r of rows) {
    const cur = currencyOf.get(r.accountId)!;
    const days = perCurrency.get(cur) ?? new Map();
    perCurrency.set(cur, days);
    const day = dayOf(r.recordedAt);
    const accts = days.get(day) ?? new Map();
    days.set(day, accts);
    accts.set(r.accountId, r.balanceCents);
  }
  const out: { currency: string; points: SeriesPoint[] }[] = [];
  for (const [currency, daysMap] of [...perCurrency.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const carried = new Map<string, number>();
    const points: SeriesPoint[] = [];
    for (const day of [...daysMap.keys()].sort()) {
      for (const [acct, bal] of daysMap.get(day)!) carried.set(acct, bal);
      let total = 0;
      for (const bal of carried.values()) total += bal;
      points.push({ date: day, balanceCents: total });
    }
    out.push({ currency, points });
  }
  return out;
}
