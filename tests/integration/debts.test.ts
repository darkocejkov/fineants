import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic } from "../helpers/seed";
import { seedDebts } from "../helpers/seed2b";
import type { Db } from "@/lib/db/client";
import {
  validateDebtInput, createDebt, updateDebt, getDebt, listDebts, setDebtClosed, deleteDebt, listPayments, addPayment, deletePayment, linkTransaction,
  candidateTransactions, listDebtsWithStatus, lenders, totalsRemainingByCurrency, totalsByLender, upcomingDebts,
} from "@/lib/queries/debts";

let db: Db;
beforeEach(() => {
  db = makeTestDb();
  seedBasic(db);
});
const TODAY = "2026-09-09";
const ok = { name: "Laptop", lender: "Flexiti", currency: "CAD", kind: "bnpl" as const, principalCents: 120000, openedOn: "2026-09-01", interestFreeUntil: "2027-09-01", payoffDueOn: "2027-09-01" };

describe("validation and CRUD", () => {
  it("validates", () => {
    expect(validateDebtInput(ok)).toBeNull();
    expect(validateDebtInput({ ...ok, name: "" })).toMatch(/name/i);
    expect(validateDebtInput({ ...ok, lender: " " })).toMatch(/lender/i);
    expect(validateDebtInput({ ...ok, principalCents: 0 })).toMatch(/principal/i);
    expect(validateDebtInput({ ...ok, openedOn: "nope" })).toMatch(/opened/i);
    expect(validateDebtInput({ ...ok, dueDay: 32 })).toMatch(/day of the month/i);
    expect(validateDebtInput({ ...ok, instalmentAmountCents: 1000 })).toMatch(/schedule/i);
    expect(validateDebtInput({ ...ok, instalmentAmountCents: 1000, cadence: "custom_days", firstInstalmentOn: "2026-10-01" })).toMatch(/interval/i);
    expect(validateDebtInput({ ...ok, instalmentAmountCents: 1000, cadence: "monthly", firstInstalmentOn: "2026-10-01", instalmentCount: 0 })).toMatch(/count/i);
  });
  it("creates, updates, closes, deletes", () => {
    const d = createDebt(db, ok);
    expect(getDebt(db, d.id)).toMatchObject({ name: "Laptop", lender: "Flexiti", kind: "bnpl" });
    updateDebt(db, d.id, { ...ok, notes: "12 months no interest" });
    expect(getDebt(db, d.id)?.notes).toBe("12 months no interest");
    setDebtClosed(db, d.id, true);
    expect(listDebts(db)).toHaveLength(0);
    expect(listDebts(db, { includeClosed: true })).toHaveLength(1);
    setDebtClosed(db, d.id, false);
    deleteDebt(db, d.id);
    expect(listDebts(db, { includeClosed: true })).toHaveLength(0);
  });
});

describe("payments and linking", () => {
  it("adds and deletes manual payments", () => {
    const { couchId } = seedDebts(db);
    const p = addPayment(db, { debtId: couchId, paidOn: "2026-09-15", amountCents: 10000 });
    expect(listPayments(db, couchId)).toHaveLength(2);
    deletePayment(db, p.id);
    expect(listPayments(db, couchId)).toHaveLength(1);
    expect(() => addPayment(db, { debtId: couchId, paidOn: "bad", amountCents: 1 })).toThrow(/date/i);
    expect(() => addPayment(db, { debtId: couchId, paidOn: "2026-09-15", amountCents: 0 })).toThrow(/amount/i);
  });
  it("links a transaction with defaults from it, once", () => {
    const { couchId, loanId } = seedDebts(db);
    const p = linkTransaction(db, { debtId: couchId, transactionId: "t4" });
    expect(p).toMatchObject({ debtId: couchId, transactionId: "t4", amountCents: 8000, paidOn: "2026-08-30" });
    expect(() => linkTransaction(db, { debtId: loanId, transactionId: "t4" })).toThrow(/already pays Couch/);
    const q = linkTransaction(db, { debtId: loanId, transactionId: "t2", amountCents: 1000, paidOn: "2026-09-08", note: "partial" });
    expect(q).toMatchObject({ amountCents: 1000, paidOn: "2026-09-08", note: "partial" });
    expect(() => linkTransaction(db, { debtId: loanId, transactionId: "missing" })).toThrow(/not found/i);
  });
  it("lists candidate outflows not yet linked, filtered by text and amount", () => {
    const { couchId } = seedDebts(db);
    const all = candidateTransactions(db, {});
    expect(all.map((c) => c.id)).toEqual(["t7", "t1", "t2", "t8", "t4", "t5"]); // outflows, newest first, hidden excluded
    linkTransaction(db, { debtId: couchId, transactionId: "t4" });
    expect(candidateTransactions(db, {}).map((c) => c.id)).not.toContain("t4");
    expect(candidateTransactions(db, { q: "grocery" }).map((c) => c.id)).toEqual(["t1"]);
    expect(candidateTransactions(db, { amountCents: 30000 }).map((c) => c.id)).toEqual(["t5"]);
    expect(candidateTransactions(db, { amountCents: 30200 }).map((c) => c.id)).toEqual(["t5"]); // within 1%
    expect(candidateTransactions(db, { limit: 2 })).toHaveLength(2);
  });
});

describe("status and totals", () => {
  it("computes remaining, next due, status, sorted by lender", () => {
    seedDebts(db);
    const rows = listDebtsWithStatus(db, { today: TODAY });
    expect(rows.map((r) => r.lender)).toEqual(["Affirm", "OSAP"]);
    const couch = rows[0];
    expect(couch).toMatchObject({ paidCents: 10000, remainingCents: 30000, nextDue: "2026-09-15", status: "due_soon", paymentCount: 1 });
    expect(rows[1]).toMatchObject({ remainingCents: 1500000, nextDue: "2026-09-15", status: "due_soon" });
  });
  it("lenders, totals by currency and lender", () => {
    seedDebts(db);
    createDebt(db, ok); // Flexiti, 120000
    expect(lenders(db)).toEqual(["Affirm", "Flexiti", "OSAP"]);
    expect(totalsRemainingByCurrency(db)).toEqual([{ currency: "CAD", remainingCents: 30000 + 1500000 + 120000, open: 3 }]);
    expect(totalsByLender(db).find((t) => t.lender === "Affirm")).toEqual({ lender: "Affirm", currency: "CAD", remainingCents: 30000, count: 1 });
  });
  it("excludes closed debts from totals and clamps overpayment at zero", () => {
    const { couchId, loanId } = seedDebts(db);
    addPayment(db, { debtId: couchId, paidOn: "2026-09-08", amountCents: 50000 });
    setDebtClosed(db, loanId, true);
    expect(totalsRemainingByCurrency(db)).toEqual([{ currency: "CAD", remainingCents: 0, open: 1 }]);
    expect(listDebtsWithStatus(db, { today: TODAY })[0].status).toBe("paid_off");
  });
  it("upcoming debts within the window", () => {
    seedDebts(db);
    createDebt(db, ok); // payoff 2027-09-01, not upcoming
    const items = upcomingDebts(db, { today: TODAY, days: 7 });
    expect(items.map((i) => [i.name, i.dueOn, i.amountCents])).toEqual([["Couch", "2026-09-15", 10000], ["Student loan", "2026-09-15", 0]]);
    expect(upcomingDebts(db, { today: TODAY, days: 2 })).toEqual([]);
  });
});
