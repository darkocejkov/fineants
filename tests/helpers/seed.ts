import type { Db } from "@/lib/db/client";
import { accounts, balanceSnapshots, connections, syncRuns, transactions } from "@/lib/db/schema";

export const T0 = Date.UTC(2026, 8, 9, 12, 0, 0); // 2026-09-09T12:00Z
const day = (n: number) => Math.floor(T0 / 1000) - n * 86400;
const iso = (n: number) => new Date(T0 - n * 86400 * 1000).toISOString();

export function seedBasic(db: Db) {
  db.insert(connections).values({ id: "org-1", name: "Example Bank", raw: "{}", firstSeenAt: iso(30), lastSeenAt: iso(0) }).run();
  db.insert(accounts).values([
    { id: "CHQ", connectionId: "org-1", name: "Chequing", currency: "CAD", balanceCents: 100000, balanceDate: day(0), raw: "{}", firstSeenAt: iso(30), lastSeenAt: iso(0) },
    { id: "VISA", connectionId: "org-1", name: "Visa", currency: "CAD", balanceCents: -50000, balanceDate: day(0), raw: "{}", type: "credit", firstSeenAt: iso(30), lastSeenAt: iso(0) },
    { id: "HIDDEN", connectionId: "org-1", name: "Old", currency: "CAD", balanceCents: 999, balanceDate: day(0), raw: "{}", hidden: true, firstSeenAt: iso(30), lastSeenAt: iso(0) },
    { id: "USD", connectionId: "org-1", name: "USD Savings", currency: "USD", balanceCents: 250000, balanceDate: day(0), raw: "{}", firstSeenAt: iso(30), lastSeenAt: iso(0) },
  ]).run();
  const tx = (id: string, accountId: string, n: number, amountCents: number, description: string, payee?: string, pending = false) => ({
    id, accountId, posted: pending ? 0 : day(n), transactedAt: pending ? day(n) : null, amountCents, description, payee: payee ?? null, memo: null, pending, raw: "{}", firstSeenAt: iso(n), lastSeenAt: iso(0),
  });
  db.insert(transactions).values([
    tx("t1", "CHQ", 1, -4510, "GROCERY MART", "Grocery Mart"),
    tx("t2", "CHQ", 2, -1200, "COFFEE", "Coffee"),
    tx("t3", "CHQ", 3, 250000, "PAYROLL", "Employer"),
    tx("t4", "VISA", 10, -8000, "GAS STATION", "Gas"),
    tx("t5", "VISA", 40, -30000, "OLD PURCHASE", "Old Shop"),
    tx("t6", "HIDDEN", 1, -99999, "SHOULD NOT COUNT"),
    tx("t7", "CHQ", 0, -500, "PENDING SNACK", "Snack", true),
    tx("t8", "USD", 5, -1000, "USD THING", "Usd Shop"),
  ]).run();
  const run = db.insert(syncRuns).values({ trigger: "cli", status: "success", startedAt: iso(0), finishedAt: iso(0), windowStart: day(90), windowEnd: day(0) }).returning({ id: syncRuns.id }).get();
  db.insert(balanceSnapshots).values([
    { accountId: "CHQ", syncRunId: run.id, balanceCents: 90000, balanceDate: day(2), recordedAt: iso(2) },
    { accountId: "CHQ", syncRunId: run.id, balanceCents: 95000, balanceDate: day(1), recordedAt: iso(1) },
    { accountId: "CHQ", syncRunId: run.id, balanceCents: 100000, balanceDate: day(0), recordedAt: iso(0) },
    { accountId: "VISA", syncRunId: run.id, balanceCents: -40000, balanceDate: day(2), recordedAt: iso(2) },
    { accountId: "VISA", syncRunId: run.id, balanceCents: -50000, balanceDate: day(0), recordedAt: iso(0) },
    { accountId: "HIDDEN", syncRunId: run.id, balanceCents: 999, balanceDate: day(0), recordedAt: iso(0) },
    { accountId: "USD", syncRunId: run.id, balanceCents: 250000, balanceDate: day(0), recordedAt: iso(0) },
  ]).run();
  return { runId: run.id };
}
