"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { CADENCES, DEBT_KINDS, type Cadence, type DebtKind } from "@/lib/db/schema";
import { createDebt, updateDebt, setDebtClosed, deleteDebt, addPayment, deletePayment, linkTransaction, DebtError, type DebtInput } from "@/lib/queries/debts";

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}
function intOrNull(fd: FormData, k: string): number | null {
  const s = str(fd, k);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function moneyOrNull(fd: FormData, k: string): number | null {
  const s = str(fd, k).replace(/[,$\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function safeReturn(raw: FormDataEntryValue | null, fallback: string): string {
  const s = String(raw ?? "");
  return /^\/(?![/\\])/.test(s) ? s : fallback;
}
function revalidate(id?: number): void {
  for (const p of ["/", "/debts", "/transactions"]) revalidatePath(p);
  revalidatePath("/accounts/[id]", "page");
  if (id) revalidatePath(`/debts/${id}`);
}
function fail(path: string, err: unknown): never {
  const message = err instanceof DebtError ? err.message : "Something went wrong saving that.";
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

function inputFrom(fd: FormData): DebtInput {
  const kind = str(fd, "kind");
  const cadence = str(fd, "cadence");
  const apr = str(fd, "apr");
  return {
    name: str(fd, "name"),
    lender: str(fd, "lender"),
    currency: str(fd, "currency") || "CAD",
    kind: (DEBT_KINDS as readonly string[]).includes(kind) ? (kind as DebtKind) : "other",
    principalCents: moneyOrNull(fd, "principal") ?? 0,
    openedOn: str(fd, "openedOn"),
    interestFreeUntil: str(fd, "interestFreeUntil") || null,
    payoffDueOn: str(fd, "payoffDueOn") || null,
    aprBps: apr ? Math.round(Number(apr) * 100) : null,
    dueDay: intOrNull(fd, "dueDay"),
    instalmentAmountCents: moneyOrNull(fd, "instalmentAmount"),
    cadence: cadence && (CADENCES as readonly string[]).includes(cadence) ? (cadence as Cadence) : null,
    intervalDays: intOrNull(fd, "intervalDays"),
    firstInstalmentOn: str(fd, "firstInstalmentOn") || null,
    instalmentCount: intOrNull(fd, "instalmentCount"),
    notes: str(fd, "notes") || null,
  };
}

export async function createDebtAction(fd: FormData): Promise<void> {
  let id = 0;
  try {
    id = createDebt(getDb(), inputFrom(fd)).id;
  } catch (e) {
    fail("/debts", e);
  }
  revalidate(id);
  redirect(`/debts/${id}`);
}

export async function updateDebtAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id)) redirect("/debts");
  try {
    updateDebt(getDb(), id, inputFrom(fd));
  } catch (e) {
    fail(`/debts/${id}?edit=1`, e);
  }
  revalidate(id);
  redirect(`/debts/${id}?saved=1`);
}

export async function setDebtClosedAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id)) {
    setDebtClosed(getDb(), id, str(fd, "closed") === "1");
    revalidate(id);
  }
  redirect(`/debts/${id}`);
}

export async function deleteDebtAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id)) {
    deleteDebt(getDb(), id);
    revalidate();
  }
  redirect("/debts");
}

export async function addPaymentAction(fd: FormData): Promise<void> {
  const debtId = Number(str(fd, "debtId"));
  if (!Number.isInteger(debtId)) redirect("/debts");
  try {
    addPayment(getDb(), { debtId, paidOn: str(fd, "paidOn"), amountCents: moneyOrNull(fd, "amount") ?? 0, note: str(fd, "note") || null });
  } catch (e) {
    fail(`/debts/${debtId}`, e);
  }
  revalidate(debtId);
  redirect(`/debts/${debtId}?saved=payment`);
}

export async function deletePaymentAction(fd: FormData): Promise<void> {
  const debtId = Number(str(fd, "debtId"));
  const paymentId = Number(str(fd, "paymentId"));
  if (Number.isInteger(paymentId)) {
    deletePayment(getDb(), paymentId);
    revalidate(debtId);
  }
  redirect(`/debts/${debtId}`);
}

export async function linkTransactionAction(fd: FormData): Promise<void> {
  const debtId = Number(str(fd, "debtId"));
  const transactionId = str(fd, "transactionId");
  const back = safeReturn(fd.get("returnTo"), `/debts/${debtId}`);
  if (!Number.isInteger(debtId) || !transactionId) redirect(back);
  try {
    linkTransaction(getDb(), { debtId, transactionId, amountCents: moneyOrNull(fd, "amount") ?? undefined, paidOn: str(fd, "paidOn") || undefined, note: str(fd, "note") || null });
  } catch (e) {
    fail(back, e);
  }
  revalidate(debtId);
  redirect(`${back}${back.includes("?") ? "&" : "?"}saved=link`);
}
