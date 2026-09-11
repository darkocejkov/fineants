import type { Db } from "@/lib/db/client";
import { externalDebts, debtPayments, recurringCosts, transactions } from "@/lib/db/schema";

const ISO = "2026-09-09T12:00:00.000Z";

export function seedRecurring(db: Db): { spotifyId: number; rentId: number } {
  const spotify = db.insert(recurringCosts).values({
    name: "Spotify", provider: "Spotify", currency: "CAD", amountCents: 1299, cadence: "monthly", anchorOn: "2026-09-05",
    matchPattern: "spotify", matchToleranceBps: 1000, active: true, createdAt: ISO, updatedAt: ISO,
  }).returning({ id: recurringCosts.id }).get();
  const rent = db.insert(recurringCosts).values({
    name: "Rent", currency: "CAD", amountCents: 180000, cadence: "monthly", anchorOn: "2026-09-01",
    matchToleranceBps: 1000, active: true, createdAt: ISO, updatedAt: ISO,
  }).returning({ id: recurringCosts.id }).get();
  return { spotifyId: spotify.id, rentId: rent.id };
}

function sec(date: string): number {
  return Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000);
}

/** Spotify outflows on CHQ (seedBasic must have run). */
export function seedRecurringTransactions(db: Db): void {
  const row = (id: string, date: string, amountCents: number, description: string, payee: string | null) => ({
    id, accountId: "CHQ", posted: sec(date), transactedAt: null, amountCents, description, payee, memo: null, pending: false, raw: "{}",
    firstSeenAt: ISO, lastSeenAt: ISO, localDate: date,
  });
  db.insert(transactions).values([
    row("sp-1", "2026-08-05", -1299, "SPOTIFY P1234", "Spotify AB"),
    row("sp-2", "2026-09-05", -1299, "SPOTIFY P1234", "Spotify AB"),
    row("sp-near", "2026-09-06", -1250, "Spotify family", null),
  ]).run();
}

export function seedDebts(db: Db): { couchId: number; loanId: number } {
  const couch = db.insert(externalDebts).values({
    name: "Couch", lender: "Affirm", currency: "CAD", kind: "bnpl", principalCents: 40000, openedOn: "2026-09-01",
    instalmentAmountCents: 10000, cadence: "biweekly", firstInstalmentOn: "2026-09-01", instalmentCount: 4, createdAt: ISO, updatedAt: ISO,
  }).returning({ id: externalDebts.id }).get();
  const loan = db.insert(externalDebts).values({
    name: "Student loan", lender: "OSAP", currency: "CAD", kind: "loan", principalCents: 1500000, openedOn: "2020-09-01", dueDay: 15, aprBps: 0, createdAt: ISO, updatedAt: ISO,
  }).returning({ id: externalDebts.id }).get();
  db.insert(debtPayments).values({ debtId: couch.id, paidOn: "2026-09-01", amountCents: 10000, createdAt: ISO }).run();
  return { couchId: couch.id, loanId: loan.id };
}
