import type { RecurringCostRow } from "../db/schema";
import { dueAt, nearestDueIndex } from "../recurring/schedule";
import { daysBetween } from "../time";

export type RecurringCostLike = Pick<RecurringCostRow, "id" | "currency" | "amountCents" | "cadence" | "intervalDays" | "anchorOn" | "accountId" | "matchPattern" | "matchToleranceBps" | "categoryId">;
export type RecurringCandidate = {
  id: string;
  accountId: string;
  currency: string;
  amountCents: number;
  payee: string | null;
  description: string;
  localDate: string;
  isTransfer: boolean;
  hidden: boolean;
  pending: boolean;
  manualCostId: number | null;
};
export type RecurringLink = { transactionId: string; dueOn: string };

function textMatches(c: RecurringCandidate, needle: string): boolean {
  return (c.payee ?? "").toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle);
}

/**
 * One transaction per due date: every eligible outflow is assigned to its nearest due date; when
 * several share one, the closest wins and the rest stay unlinked. A period holding a manual link
 * to this cost is taken; manual rows themselves are never returned (the pass never rewrites them).
 */
export function matchRecurring(cost: RecurringCostLike, candidates: RecurringCandidate[]): RecurringLink[] {
  const needle = cost.matchPattern?.trim().toLowerCase() ?? "";
  if (!needle) return [];
  const lo = cost.amountCents * (1 - cost.matchToleranceBps / 10000);
  const hi = cost.amountCents * (1 + cost.matchToleranceBps / 10000);

  const taken = new Set<number>();
  for (const c of candidates) {
    if (c.manualCostId === cost.id) taken.add(nearestDueIndex(cost, c.localDate));
  }

  const byDue = new Map<number, { c: RecurringCandidate; dist: number }>();
  for (const c of candidates) {
    if (c.manualCostId !== null || c.isTransfer || c.hidden || c.pending) continue;
    if (c.currency !== cost.currency || c.amountCents >= 0) continue;
    if (cost.accountId && c.accountId !== cost.accountId) continue;
    const abs = -c.amountCents;
    if (abs < lo || abs > hi) continue;
    if (!textMatches(c, needle)) continue;
    const k = nearestDueIndex(cost, c.localDate);
    if (taken.has(k)) continue;
    const dist = Math.abs(daysBetween(dueAt(cost, k), c.localDate));
    const cur = byDue.get(k);
    if (!cur || dist < cur.dist || (dist === cur.dist && c.id < cur.c.id)) byDue.set(k, { c, dist });
  }
  return [...byDue.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, { c }]) => ({ transactionId: c.id, dueOn: dueAt(cost, k) }));
}
