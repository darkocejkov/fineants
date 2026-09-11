import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, CADENCES, DEBT_KINDS, debtPayments, externalDebts, transactionMeta, transactions, type Cadence, type DebtKind, type DebtPaymentRow, type ExternalDebtRow } from "../db/schema";
import { addDays, isDateString } from "../time";
import { debtStatus, hasSchedule, nextDue, projectedInstalments, remainingCents as rawRemaining, type DebtStatus } from "../debts/schedule";
import { escapeLikePattern, notTransfer } from "./transactions";

export type DebtInput = {
  name: string;
  lender: string;
  currency: string;
  kind: DebtKind;
  principalCents: number;
  openedOn: string;
  interestFreeUntil?: string | null;
  payoffDueOn?: string | null;
  aprBps?: number | null;
  dueDay?: number | null;
  instalmentAmountCents?: number | null;
  cadence?: Cadence | null;
  intervalDays?: number | null;
  firstInstalmentOn?: string | null;
  instalmentCount?: number | null;
  notes?: string | null;
};

export class DebtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebtError";
  }
}

const now = () => new Date().toISOString();

export function validateDebtInput(i: DebtInput): string | null {
  if (!i.name.trim()) return "A debt needs a name.";
  if (!i.lender.trim()) return "Say who the lender is.";
  if (!i.currency.trim()) return "Choose a currency.";
  if (!(DEBT_KINDS as readonly string[]).includes(i.kind)) return "Choose the kind of debt.";
  if (!Number.isInteger(i.principalCents) || i.principalCents <= 0) return "The principal must be more than zero.";
  if (!isDateString(i.openedOn)) return "The opened date must be a real date (YYYY-MM-DD).";
  for (const [label, v] of [["interest-free-until", i.interestFreeUntil], ["payoff due", i.payoffDueOn], ["first instalment", i.firstInstalmentOn]] as const) {
    if (v && !isDateString(v)) return `The ${label} date must be a real date (YYYY-MM-DD).`;
  }
  if (i.aprBps != null && (!Number.isInteger(i.aprBps) || i.aprBps < 0)) return "APR cannot be negative.";
  if (i.dueDay != null && (!Number.isInteger(i.dueDay) || i.dueDay < 1 || i.dueDay > 31)) return "The due day must be a day of the month, 1 to 31.";
  const scheduleParts = [i.instalmentAmountCents != null, i.cadence != null, i.firstInstalmentOn != null];
  const some = scheduleParts.some(Boolean);
  const all = scheduleParts.every(Boolean);
  if (some && !all) return "A schedule needs the instalment amount, how often, and the first instalment date together.";
  if (all) {
    if (!Number.isInteger(i.instalmentAmountCents) || i.instalmentAmountCents! <= 0) return "The instalment amount must be more than zero.";
    if (!(CADENCES as readonly string[]).includes(i.cadence!)) return "Choose how often instalments fall.";
    if (i.cadence === "custom_days" && (!i.intervalDays || i.intervalDays <= 0)) return "A custom cadence needs an interval in days.";
    if (i.instalmentCount != null && (!Number.isInteger(i.instalmentCount) || i.instalmentCount <= 0)) return "The instalment count must be a positive whole number, or blank for until paid off.";
  }
  return null;
}

function toRow(i: DebtInput, nowIso: string) {
  const scheduled = i.instalmentAmountCents != null && i.cadence != null && i.firstInstalmentOn != null;
  return {
    name: i.name.trim(),
    lender: i.lender.trim(),
    currency: i.currency.trim(),
    kind: i.kind,
    principalCents: i.principalCents,
    openedOn: i.openedOn,
    interestFreeUntil: i.interestFreeUntil || null,
    payoffDueOn: i.payoffDueOn || null,
    aprBps: i.aprBps ?? null,
    dueDay: i.dueDay ?? null,
    instalmentAmountCents: scheduled ? i.instalmentAmountCents! : null,
    cadence: scheduled ? i.cadence! : null,
    intervalDays: scheduled && i.cadence === "custom_days" ? (i.intervalDays ?? null) : null,
    firstInstalmentOn: scheduled ? i.firstInstalmentOn! : null,
    instalmentCount: scheduled ? (i.instalmentCount ?? null) : null,
    notes: i.notes?.trim() || null,
    updatedAt: nowIso,
  };
}

export function listDebts(db: Db, opts: { includeClosed?: boolean } = {}): ExternalDebtRow[] {
  const q = db.select().from(externalDebts);
  return (opts.includeClosed ? q : q.where(isNull(externalDebts.closedAt))).orderBy(asc(sql`lower(${externalDebts.lender})`), asc(externalDebts.name)).all();
}

export function getDebt(db: Db, id: number): ExternalDebtRow | undefined {
  return db.select().from(externalDebts).where(eq(externalDebts.id, id)).get();
}

export function createDebt(db: Db, input: DebtInput, nowIso = now()): ExternalDebtRow {
  const problem = validateDebtInput(input);
  if (problem) throw new DebtError(problem);
  return db.insert(externalDebts).values({ ...toRow(input, nowIso), createdAt: nowIso }).returning().get();
}

export function updateDebt(db: Db, id: number, input: DebtInput, nowIso = now()): void {
  const problem = validateDebtInput(input);
  if (problem) throw new DebtError(problem);
  db.update(externalDebts).set(toRow(input, nowIso)).where(eq(externalDebts.id, id)).run();
}

export function setDebtClosed(db: Db, id: number, closed: boolean, nowIso = now()): void {
  db.update(externalDebts).set({ closedAt: closed ? nowIso : null, updatedAt: nowIso }).where(eq(externalDebts.id, id)).run();
}

export function deleteDebt(db: Db, id: number): void {
  db.delete(externalDebts).where(eq(externalDebts.id, id)).run();
}

export function listPayments(db: Db, debtId: number): DebtPaymentRow[] {
  return db.select().from(debtPayments).where(eq(debtPayments.debtId, debtId)).orderBy(asc(debtPayments.paidOn), asc(debtPayments.id)).all();
}

export function addPayment(db: Db, input: { debtId: number; paidOn: string; amountCents: number; note?: string | null; transactionId?: string | null }, nowIso = now()): DebtPaymentRow {
  if (!isDateString(input.paidOn)) throw new DebtError("The payment date must be a real date (YYYY-MM-DD).");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new DebtError("The payment amount must be more than zero.");
  if (!getDebt(db, input.debtId)) throw new DebtError("That debt no longer exists.");
  return db
    .insert(debtPayments)
    .values({ debtId: input.debtId, paidOn: input.paidOn, amountCents: input.amountCents, note: input.note?.trim() || null, transactionId: input.transactionId ?? null, createdAt: nowIso })
    .returning()
    .get();
}

export function deletePayment(db: Db, paymentId: number): void {
  db.delete(debtPayments).where(eq(debtPayments.id, paymentId)).run();
}

/** Set a bank transaction against a debt. Amount and date default to the transaction's; one transaction pays at most one debt. */
export function linkTransaction(db: Db, input: { debtId: number; transactionId: string; amountCents?: number; paidOn?: string; note?: string | null }, nowIso = now()): DebtPaymentRow {
  const tx = db
    .select({ amountCents: transactions.amountCents, localDate: transactions.localDate, currency: accounts.currency })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(eq(transactions.id, input.transactionId))
    .get();
  if (!tx) throw new DebtError("That transaction was not found.");
  const debt = getDebt(db, input.debtId);
  if (!debt) throw new DebtError("That debt no longer exists.");
  // The payment is recorded in the debt's currency, so a transaction from an account in another
  // one would silently add the wrong number of cents to the balance. There is no conversion rate
  // here by design; say so and let the owner enter the payment by hand.
  if (tx.currency !== debt.currency) throw new DebtError(`That transaction is in ${tx.currency}; this debt is in ${debt.currency}.`);
  const existing = db
    .select({ name: externalDebts.name })
    .from(debtPayments)
    .innerJoin(externalDebts, eq(externalDebts.id, debtPayments.debtId))
    .where(eq(debtPayments.transactionId, input.transactionId))
    .get();
  if (existing) throw new DebtError(`That transaction already pays ${existing.name}.`);
  return addPayment(
    db,
    { debtId: input.debtId, paidOn: input.paidOn ?? tx.localDate ?? nowIso.slice(0, 10), amountCents: input.amountCents ?? Math.abs(tx.amountCents), note: input.note, transactionId: input.transactionId },
    nowIso,
  );
}

export type CandidateTx = { id: string; localDate: string | null; payee: string | null; description: string; amountCents: number; currency: string; accountName: string };

/** Recent non-hidden, non-transfer outflows not yet set against any debt, optionally in one currency. */
export function candidateTransactions(db: Db, opts: { q?: string; amountCents?: number; limit?: number; currency?: string }): CandidateTx[] {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 20));
  const q = opts.q?.trim().toLowerCase();
  const parts = [
    eq(accounts.hidden, false),
    sql`${transactions.amountCents} < 0`,
    isNull(debtPayments.id),
    notTransfer,
    opts.currency ? eq(accounts.currency, opts.currency) : undefined,
    q ? sql`(lower(coalesce(${transactions.payee}, '')) like ${"%" + escapeLikePattern(q) + "%"} escape '\\' or lower(${transactions.description}) like ${"%" + escapeLikePattern(q) + "%"} escape '\\')` : undefined,
    opts.amountCents ? sql`abs(-${transactions.amountCents} - ${opts.amountCents}) <= ${Math.ceil(opts.amountCents / 100)}` : undefined,
  ];
  return db
    .select({
      id: transactions.id,
      localDate: transactions.localDate,
      payee: transactions.payee,
      description: transactions.description,
      amountCents: transactions.amountCents,
      currency: accounts.currency,
      accountName: sql<string>`coalesce(nullif(trim(${accounts.nickname}), ''), ${accounts.name})`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(debtPayments, eq(debtPayments.transactionId, transactions.id))
    .leftJoin(transactionMeta, eq(transactionMeta.transactionId, transactions.id))
    .where(and(...parts))
    .orderBy(desc(transactions.localDate), desc(transactions.id))
    .limit(limit)
    .all();
}

export type DebtWithStatus = ExternalDebtRow & { paidCents: number; remainingCents: number; nextDue: string | null; status: DebtStatus; paymentCount: number };

export function listDebtsWithStatus(db: Db, opts: { today: string; includeClosed?: boolean }): DebtWithStatus[] {
  const rows = listDebts(db, { includeClosed: opts.includeClosed }).map((d) => {
    const payments = listPayments(db, d.id);
    const paid = payments.reduce((n, p) => n + p.amountCents, 0);
    return { ...d, paidCents: paid, remainingCents: Math.max(0, rawRemaining(d, payments)), nextDue: nextDue(d, payments, opts.today), status: debtStatus(d, payments, opts.today), paymentCount: payments.length };
  });
  return rows.sort((a, b) => {
    const l = a.lender.toLowerCase().localeCompare(b.lender.toLowerCase());
    if (l !== 0) return l;
    if (a.nextDue !== b.nextDue) {
      if (a.nextDue === null) return 1;
      if (b.nextDue === null) return -1;
      return a.nextDue < b.nextDue ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function lenders(db: Db): string[] {
  return db.selectDistinct({ lender: externalDebts.lender }).from(externalDebts).orderBy(asc(externalDebts.lender)).all().map((r) => r.lender);
}

export function totalsRemainingByCurrency(db: Db): { currency: string; remainingCents: number; open: number }[] {
  const out = new Map<string, { remainingCents: number; open: number }>();
  for (const d of listDebts(db)) {
    const payments = listPayments(db, d.id);
    const cur = out.get(d.currency) ?? { remainingCents: 0, open: 0 };
    cur.remainingCents += Math.max(0, rawRemaining(d, payments));
    cur.open += 1;
    out.set(d.currency, cur);
  }
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => ({ currency, ...v }));
}

export function totalsByLender(db: Db): { lender: string; currency: string; remainingCents: number; count: number }[] {
  const out = new Map<string, { lender: string; currency: string; remainingCents: number; count: number }>();
  for (const d of listDebts(db)) {
    const key = `${d.lender.toLowerCase()}|${d.currency}`;
    const cur = out.get(key) ?? { lender: d.lender, currency: d.currency, remainingCents: 0, count: 0 };
    cur.remainingCents += Math.max(0, rawRemaining(d, listPayments(db, d.id)));
    cur.count += 1;
    out.set(key, cur);
  }
  return [...out.values()].sort((a, b) => a.lender.toLowerCase().localeCompare(b.lender.toLowerCase()) || a.currency.localeCompare(b.currency));
}

export type UpcomingDebt = { kind: "debt"; id: number; name: string; lender: string; currency: string; amountCents: number; dueOn: string; status: DebtStatus };

export function upcomingDebts(db: Db, opts: { today: string; days: number }): UpcomingDebt[] {
  const horizon = addDays(opts.today, opts.days);
  const items: UpcomingDebt[] = [];
  for (const d of listDebtsWithStatus(db, { today: opts.today })) {
    if (d.status === "paid_off" || !d.nextDue || d.nextDue > horizon) continue;
    let amountCents = 0;
    if (hasSchedule(d)) {
      const open = projectedInstalments(d, listPayments(db, d.id), opts.today).find((i) => i.paidCents < i.amountCents);
      amountCents = open ? open.amountCents - open.paidCents : 0;
    } else if (d.payoffDueOn && d.nextDue === d.payoffDueOn) {
      amountCents = d.remainingCents;
    }
    items.push({ kind: "debt", id: d.id, name: d.name, lender: d.lender, currency: d.currency, amountCents, dueOn: d.nextDue, status: d.status });
  }
  return items.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.name.localeCompare(b.name)));
}
