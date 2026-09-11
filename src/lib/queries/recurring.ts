import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, CADENCES, recurringCosts, transactionMeta, transactions, type Cadence, type RecurringCostRow } from "../db/schema";
import { isDateString, addDays } from "../time";
import { currentIndex, dueAt, monthlyEquivalentCents, periodWindow, recurringStatus, type RecurringStatus } from "../recurring/schedule";
import { escapeLikePattern } from "./transactions";

export type RecurringInput = {
  name: string;
  provider?: string | null;
  currency: string;
  amountCents: number;
  cadence: Cadence;
  intervalDays?: number | null;
  anchorOn: string;
  categoryId?: number | null;
  accountId?: string | null;
  matchPattern?: string | null;
  matchToleranceBps?: number;
  active?: boolean;
  notes?: string | null;
};

export class RecurringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurringError";
  }
}

const now = () => new Date().toISOString();

export function validateRecurringInput(input: RecurringInput): string | null {
  if (!input.name.trim()) return "A recurring cost needs a name.";
  if (!input.currency.trim()) return "Choose a currency.";
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return "The expected amount must be more than zero.";
  if (!(CADENCES as readonly string[]).includes(input.cadence)) return "Choose how often it recurs.";
  if (input.cadence === "custom_days" && (!input.intervalDays || !Number.isInteger(input.intervalDays) || input.intervalDays <= 0)) return "A custom cadence needs an interval in days.";
  if (!isDateString(input.anchorOn)) return "The due date must be a real date (YYYY-MM-DD).";
  const bps = input.matchToleranceBps ?? 1000;
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) return "The match tolerance must be between 0% and 100%.";
  return null;
}

function toRow(input: RecurringInput, nowIso: string) {
  const pattern = input.matchPattern?.trim() ?? "";
  return {
    name: input.name.trim(),
    provider: input.provider?.trim() || null,
    currency: input.currency.trim(),
    amountCents: input.amountCents,
    cadence: input.cadence,
    intervalDays: input.cadence === "custom_days" ? (input.intervalDays ?? null) : null,
    anchorOn: input.anchorOn,
    categoryId: input.categoryId ?? null,
    accountId: input.accountId || null,
    matchPattern: pattern || null,
    matchToleranceBps: input.matchToleranceBps ?? 1000,
    active: input.active ?? true,
    notes: input.notes?.trim() || null,
    updatedAt: nowIso,
  };
}

export function listRecurringCosts(db: Pick<Db, "select">, opts: { includeInactive?: boolean } = {}): RecurringCostRow[] {
  const q = db.select().from(recurringCosts);
  return (opts.includeInactive ? q : q.where(eq(recurringCosts.active, true))).orderBy(asc(recurringCosts.name), asc(recurringCosts.id)).all();
}

export function getRecurringCost(db: Db, id: number): RecurringCostRow | undefined {
  return db.select().from(recurringCosts).where(eq(recurringCosts.id, id)).get();
}

export function createRecurringCost(db: Db, input: RecurringInput, nowIso = now()): RecurringCostRow {
  const problem = validateRecurringInput(input);
  if (problem) throw new RecurringError(problem);
  return db.insert(recurringCosts).values({ ...toRow(input, nowIso), createdAt: nowIso }).returning().get();
}

export function updateRecurringCost(db: Db, id: number, input: RecurringInput, nowIso = now()): void {
  const problem = validateRecurringInput(input);
  if (problem) throw new RecurringError(problem);
  db.update(recurringCosts).set(toRow(input, nowIso)).where(eq(recurringCosts.id, id)).run();
}

export function setRecurringActive(db: Db, id: number, active: boolean, nowIso = now()): void {
  db.update(recurringCosts).set({ active, updatedAt: nowIso }).where(eq(recurringCosts.id, id)).run();
}

export function deleteRecurringCost(db: Db, id: number): void {
  db.delete(recurringCosts).where(eq(recurringCosts.id, id)).run();
}

export type RecurringWithStatus = RecurringCostRow & {
  dueOn: string;
  status: RecurringStatus;
  matched: { transactionId: string; localDate: string; amountCents: number } | null;
  monthlyEquivalentCents: number;
};

/** The linked transaction inside a period window, if any (manual or auto link). */
function matchedIn(db: Db, costId: number, window: { start: string; endExclusive: string }) {
  return db
    .select({ transactionId: transactions.id, localDate: transactions.localDate, amountCents: transactions.amountCents })
    .from(transactionMeta)
    .innerJoin(transactions, eq(transactions.id, transactionMeta.transactionId))
    .where(and(eq(transactionMeta.recurringCostId, costId), gte(transactions.localDate, window.start), lt(transactions.localDate, window.endExclusive)))
    .orderBy(desc(transactions.localDate))
    .get();
}

export function listRecurringWithStatus(db: Db, opts: { today: string; includeInactive?: boolean }): RecurringWithStatus[] {
  const rows = listRecurringCosts(db, { includeInactive: opts.includeInactive }).map((c) => {
    const k = currentIndex(c, opts.today);
    const dueOn = dueAt(c, k);
    const m = matchedIn(db, c.id, periodWindow(c, k));
    const matched = m && m.localDate ? { transactionId: m.transactionId, localDate: m.localDate, amountCents: m.amountCents } : null;
    return { ...c, dueOn, status: recurringStatus(dueOn, opts.today, matched !== null), matched, monthlyEquivalentCents: monthlyEquivalentCents(c.amountCents, c) };
  });
  return rows.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.name.localeCompare(b.name)));
}

/** Non-hidden outflows in the cost's currency (and account) whose text contains the pattern and whose size is within tolerance. Read-only. */
export function previewPatternMatches(
  db: Db,
  input: Pick<RecurringInput, "currency" | "amountCents" | "accountId" | "matchPattern" | "matchToleranceBps">,
  limit = 5,
): { count: number; sample: { id: string; localDate: string | null; payee: string | null; description: string; amountCents: number; currency: string }[] } {
  const pattern = input.matchPattern?.trim().toLowerCase() ?? "";
  if (!pattern) return { count: 0, sample: [] };
  const bps = input.matchToleranceBps ?? 1000;
  const lo = Math.floor(input.amountCents * (1 - bps / 10000));
  const hi = Math.ceil(input.amountCents * (1 + bps / 10000));
  const likePattern = `%${escapeLikePattern(pattern)}%`;
  const rows = db
    .select({ id: transactions.id, localDate: transactions.localDate, payee: transactions.payee, description: transactions.description, amountCents: transactions.amountCents, currency: accounts.currency })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(accounts.hidden, false),
        eq(accounts.currency, input.currency),
        input.accountId ? eq(transactions.accountId, input.accountId) : undefined,
        sql`${transactions.amountCents} < 0`,
        sql`-${transactions.amountCents} between ${lo} and ${hi}`,
        sql`(lower(coalesce(${transactions.payee}, '')) like ${likePattern} escape '\\' or lower(${transactions.description}) like ${likePattern} escape '\\')`,
      ),
    )
    .orderBy(desc(transactions.localDate), desc(transactions.id))
    .all();
  return { count: rows.length, sample: rows.slice(0, limit) };
}

export type UpcomingRecurring = { kind: "recurring"; id: number; name: string; provider: string | null; currency: string; amountCents: number; dueOn: string; status: RecurringStatus };

/** Active costs whose current period is unpaid and whose due date is on or before today + days (overdue ones included). */
export function upcomingRecurring(db: Db, opts: { today: string; days: number }): UpcomingRecurring[] {
  const horizon = addDays(opts.today, opts.days);
  return listRecurringWithStatus(db, { today: opts.today })
    .filter((r) => r.status !== "paid" && r.dueOn <= horizon)
    .map((r) => ({ kind: "recurring" as const, id: r.id, name: r.name, provider: r.provider, currency: r.currency, amountCents: r.amountCents, dueOn: r.dueOn, status: r.status }));
}
