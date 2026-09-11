import type { ExternalDebtRow } from "../db/schema";
import { addMonths, daysBetween, daysInMonth } from "../time";
import { dueAt, type CadenceLike } from "../recurring/schedule";

export type DebtLike = Pick<
  ExternalDebtRow,
  "principalCents" | "payoffDueOn" | "interestFreeUntil" | "dueDay" | "instalmentAmountCents" | "cadence" | "intervalDays" | "firstInstalmentOn" | "instalmentCount" | "closedAt"
>;
export type PaymentLike = { paidOn: string; amountCents: number };
export type InstalmentState = "paid" | "partial" | "due" | "overdue";
export type Instalment = { index: number; dueOn: string; amountCents: number; paidCents: number; state: InstalmentState };
export type DebtStatus = "paid_off" | "overdue" | "due_soon" | "interest_starts_soon" | "on_track";

export const MAX_INSTALMENTS = 600;
export const DUE_SOON_DAYS = 14;
export const INTEREST_SOON_DAYS = 30;

export const DEBT_STATUS_WORDS: Record<DebtStatus, string> = {
  paid_off: "paid off",
  overdue: "overdue",
  due_soon: "due soon",
  interest_starts_soon: "interest starts soon",
  on_track: "on track",
};

export function paidCents(payments: PaymentLike[]): number {
  return payments.reduce((n, p) => n + p.amountCents, 0);
}

/** Principal minus payments; may go negative when the owner overpays. Display clamps at 0. */
export function remainingCents(debt: DebtLike, payments: PaymentLike[]): number {
  return debt.principalCents - paidCents(payments);
}

export function hasSchedule(debt: DebtLike): boolean {
  return debt.instalmentAmountCents !== null && debt.cadence !== null && debt.firstInstalmentOn !== null;
}

function cadenceOf(debt: DebtLike): CadenceLike {
  return { cadence: debt.cadence!, intervalDays: debt.intervalDays, anchorOn: debt.firstInstalmentOn! };
}

/** Instalments in date order with payments applied oldest-first; a payment larger than one instalment spills into the next. */
export function projectedInstalments(debt: DebtLike, payments: PaymentLike[], today: string): Instalment[] {
  if (!hasSchedule(debt)) return [];
  const c = cadenceOf(debt);
  const each = debt.instalmentAmountCents!;
  let pool = paidCents(payments);
  let cumulative = 0;
  const out: Instalment[] = [];
  for (let k = 0; k < MAX_INSTALMENTS; k++) {
    if (debt.instalmentCount !== null && k >= debt.instalmentCount) break;
    if (debt.instalmentCount === null && cumulative >= debt.principalCents) break;
    const amountCents = debt.instalmentCount === null ? Math.min(each, debt.principalCents - cumulative) : each;
    cumulative += amountCents;
    const applied = Math.min(pool, amountCents);
    pool -= applied;
    const dueOn = dueAt(c, k);
    const state: InstalmentState = applied >= amountCents ? "paid" : applied > 0 ? "partial" : today > dueOn ? "overdue" : "due";
    out.push({ index: k, dueOn, amountCents, paidCents: applied, state });
  }
  return out;
}

/** Next occurrence of a day-of-month on or after `today`, clamped to month length. */
function nextDueDay(dueDay: number, today: string): string {
  const [y, m] = today.split("-").map(Number);
  const thisMonth = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(dueDay, daysInMonth(y, m))).padStart(2, "0")}`;
  if (thisMonth >= today) return thisMonth;
  const next = addMonths(`${y}-${String(m).padStart(2, "0")}-01`, 1);
  const [ny, nm] = next.split("-").map(Number);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(dueDay, daysInMonth(ny, nm))).padStart(2, "0")}`;
}

export function nextDue(debt: DebtLike, payments: PaymentLike[], today: string): string | null {
  if (hasSchedule(debt)) {
    const open = projectedInstalments(debt, payments, today).find((i) => i.paidCents < i.amountCents);
    return open ? open.dueOn : null;
  }
  if (debt.payoffDueOn) return debt.payoffDueOn;
  if (debt.dueDay) return nextDueDay(debt.dueDay, today);
  return null;
}

export function debtStatus(debt: DebtLike, payments: PaymentLike[], today: string): DebtStatus {
  if (debt.closedAt || remainingCents(debt, payments) <= 0) return "paid_off";
  const due = nextDue(debt, payments, today);
  if (due && due < today) return "overdue";
  if (due && daysBetween(today, due) <= DUE_SOON_DAYS) return "due_soon";
  if (debt.interestFreeUntil) {
    const until = daysBetween(today, debt.interestFreeUntil);
    if (until >= 0 && until <= INTEREST_SOON_DAYS) return "interest_starts_soon";
  }
  return "on_track";
}
