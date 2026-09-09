import { and, eq, gte, lt, asc, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, balanceSnapshots } from "../db/schema";

export type SeriesPoint = { date: string; balanceCents: number };

const dayOf = (iso: string) => iso.slice(0, 10);

function sinceIso(days: number, nowMs: number): string {
  return new Date(nowMs - days * 86400 * 1000).toISOString();
}

export function accountBalanceSeries(db: Db, accountId: string, days: number, nowMs = Date.now()): SeriesPoint[] {
  const since = sinceIso(days, nowMs);
  const windowStartDate = dayOf(since);

  const byDay = new Map<string, number>();

  // Seed the window-start date with the latest balance recorded before the window, if any,
  // so the series carries forward rather than starting empty.
  const priorRows = db
    .select({ recordedAt: balanceSnapshots.recordedAt, balanceCents: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.accountId, accountId), lt(balanceSnapshots.recordedAt, since)))
    .orderBy(asc(balanceSnapshots.recordedAt))
    .all();
  const prior = priorRows.at(-1);
  if (prior) byDay.set(windowStartDate, prior.balanceCents);

  const rows = db
    .select({ recordedAt: balanceSnapshots.recordedAt, balanceCents: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.accountId, accountId), gte(balanceSnapshots.recordedAt, since)))
    .orderBy(asc(balanceSnapshots.recordedAt))
    .all();
  for (const r of rows) byDay.set(dayOf(r.recordedAt), r.balanceCents); // last write per day wins
  return [...byDay.entries()].map(([date, balanceCents]) => ({ date, balanceCents }));
}

export function netWorthSeries(db: Db, days: number, nowMs = Date.now()): { currency: string; points: SeriesPoint[] }[] {
  const visible = db.select({ id: accounts.id, currency: accounts.currency }).from(accounts).where(eq(accounts.hidden, false)).all();
  if (visible.length === 0) return [];

  const since = sinceIso(days, nowMs);
  const windowStartDate = dayOf(since);
  const visibleIds = visible.map((a) => a.id);
  const currencyOf = new Map(visible.map((a) => [a.id, a.currency]));
  const accountsByCurrency = new Map<string, string[]>();
  for (const a of visible) {
    const ids = accountsByCurrency.get(a.currency) ?? [];
    accountsByCurrency.set(a.currency, ids);
    ids.push(a.id);
  }

  // Latest balance per account recorded before the window, to seed carry-forward.
  const priorRows = db
    .select({ accountId: balanceSnapshots.accountId, recordedAt: balanceSnapshots.recordedAt, balanceCents: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(inArray(balanceSnapshots.accountId, visibleIds), lt(balanceSnapshots.recordedAt, since)))
    .orderBy(asc(balanceSnapshots.recordedAt))
    .all();
  const priorBalance = new Map<string, number>();
  for (const r of priorRows) priorBalance.set(r.accountId, r.balanceCents); // last (ascending) write wins

  const rows = db
    .select({ accountId: balanceSnapshots.accountId, recordedAt: balanceSnapshots.recordedAt, balanceCents: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(inArray(balanceSnapshots.accountId, visibleIds), gte(balanceSnapshots.recordedAt, since)))
    .orderBy(asc(balanceSnapshots.recordedAt))
    .all();

  // per currency: per day, per account last balance
  const perCurrency = new Map<string, Map<string, Map<string, number>>>(); // currency -> day -> account -> balance
  for (const r of rows) {
    const cur = currencyOf.get(r.accountId)!;
    const dayMap = perCurrency.get(cur) ?? new Map();
    perCurrency.set(cur, dayMap);
    const day = dayOf(r.recordedAt);
    const accts = dayMap.get(day) ?? new Map();
    dayMap.set(day, accts);
    accts.set(r.accountId, r.balanceCents);
  }

  const out: { currency: string; points: SeriesPoint[] }[] = [];
  for (const currency of [...accountsByCurrency.keys()].sort((a, b) => a.localeCompare(b))) {
    const carried = new Map<string, number>();
    const pointsByDate = new Map<string, number>();

    let seeded = false;
    for (const id of accountsByCurrency.get(currency)!) {
      const prior = priorBalance.get(id);
      if (prior !== undefined) {
        carried.set(id, prior);
        seeded = true;
      }
    }
    if (seeded) {
      let total = 0;
      for (const bal of carried.values()) total += bal;
      pointsByDate.set(windowStartDate, total);
    }

    const dayMap = perCurrency.get(currency);
    if (dayMap) {
      for (const day of [...dayMap.keys()].sort()) {
        for (const [acct, bal] of dayMap.get(day)!) carried.set(acct, bal);
        let total = 0;
        for (const bal of carried.values()) total += bal;
        pointsByDate.set(day, total);
      }
    }

    if (pointsByDate.size > 0) {
      out.push({ currency, points: [...pointsByDate.entries()].map(([date, balanceCents]) => ({ date, balanceCents })) });
    }
  }
  return out;
}
