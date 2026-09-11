import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { seedBasic, seedTransferPair, T0 } from "../helpers/seed";
import type { Db } from "@/lib/db/client";
import { listAccounts, getAccount, totalsByCurrency, updateAccountSettings, displayName } from "@/lib/queries/accounts";
import { accountBalanceSeries, netWorthSeries } from "@/lib/queries/balances";
import { listTransactions, recentTransactions } from "@/lib/queries/transactions";
import { spendingByPeriod, topPayees, spendingByCategory } from "@/lib/queries/spending";
import { listSyncRuns, getSyncRun, getSyncStatus } from "@/lib/queries/syncRuns";
import { setState, STATE_KEYS } from "@/lib/db/appState";
import { accounts, balanceSnapshots, connections, syncRuns, transactions } from "@/lib/db/schema";
import { createCategory } from "@/lib/queries/categories";
import { setCategory, setTransfer } from "@/lib/queries/meta";
import { seedDebts } from "../helpers/seed2b";
import { linkTransaction } from "@/lib/queries/debts";

const TODAY = "2026-09-09";

let db: Db;
let runId: number;
beforeEach(() => {
  db = makeTestDb();
  runId = seedBasic(db).runId;
});

describe("accounts", () => {
  it("lists non-hidden by default and all when asked", () => {
    expect(listAccounts(db).map((a) => a.id)).toEqual(["CHQ", "USD", "VISA"]);
    expect(listAccounts(db, { includeHidden: true })).toHaveLength(4);
  });
  it("totals by currency exclude hidden", () => {
    expect(totalsByCurrency(db)).toEqual([{ currency: "CAD", balanceCents: 50000 }, { currency: "USD", balanceCents: 250000 }]);
  });
  it("updates settings and displayName prefers nickname", () => {
    updateAccountSettings(db, "CHQ", { nickname: "Main", type: "checking", hidden: false });
    const a = getAccount(db, "CHQ")!;
    expect(a.nickname).toBe("Main");
    expect(a.type).toBe("checking");
    expect(displayName(a)).toBe("Main");
    updateAccountSettings(db, "CHQ", { nickname: null });
    expect(displayName(getAccount(db, "CHQ")!)).toBe("Chequing");
  });
  it("ignores explicit undefined fields in patch", () => {
    updateAccountSettings(db, "CHQ", { nickname: "Main" });
    updateAccountSettings(db, "CHQ", { nickname: undefined, type: "savings" });
    const a = getAccount(db, "CHQ")!;
    expect(a.nickname).toBe("Main");
    expect(a.type).toBe("savings");
  });
});

describe("balances", () => {
  it("returns one point per day for an account", () => {
    const s = accountBalanceSeries(db, "CHQ", 30, T0);
    expect(s).toEqual([
      { date: "2026-09-07", balanceCents: 90000 },
      { date: "2026-09-08", balanceCents: 95000 },
      { date: "2026-09-09", balanceCents: 100000 },
    ]);
  });
  it("net worth carries forward missing days and excludes hidden", () => {
    const series = netWorthSeries(db, 30, T0);
    const cad = series.find((s) => s.currency === "CAD")!;
    expect(cad.points).toEqual([
      { date: "2026-09-07", balanceCents: 50000 },
      { date: "2026-09-08", balanceCents: 55000 },
      { date: "2026-09-09", balanceCents: 50000 },
    ]);
    const usd = series.find((s) => s.currency === "USD")!;
    expect(usd.points).toEqual([{ date: "2026-09-09", balanceCents: 250000 }]);
  });
  it("carries forward a pre-window balance into the window-start point", () => {
    db.insert(balanceSnapshots)
      .values({ accountId: "CHQ", syncRunId: runId, balanceCents: 80000, balanceDate: Math.floor(T0 / 1000) - 40 * 86400, recordedAt: new Date(T0 - 40 * 86400 * 1000).toISOString() })
      .run();
    const series = netWorthSeries(db, 7, T0);
    const cad = series.find((s) => s.currency === "CAD")!;
    expect(cad.points).toEqual([
      { date: "2026-09-02", balanceCents: 80000 },
      { date: "2026-09-07", balanceCents: 50000 },
      { date: "2026-09-08", balanceCents: 55000 },
      { date: "2026-09-09", balanceCents: 50000 },
    ]);
  });
  it("returns one point per currency at the window start when all snapshots predate the window", () => {
    const db2 = makeTestDb();
    const iso = (n: number) => new Date(T0 - n * 86400 * 1000).toISOString();
    db2.insert(connections).values({ id: "org-2", name: "Old Bank", raw: "{}", firstSeenAt: iso(100), lastSeenAt: iso(40) }).run();
    db2.insert(accounts).values({ id: "OLD1", connectionId: "org-2", name: "Old One", currency: "CAD", balanceCents: 12345, balanceDate: Math.floor(T0 / 1000) - 40 * 86400, raw: "{}", firstSeenAt: iso(100), lastSeenAt: iso(40) }).run();
    const run2 = db2.insert(syncRuns).values({ trigger: "cli", status: "success", startedAt: iso(40), finishedAt: iso(40), windowStart: Math.floor(T0 / 1000) - 90 * 86400, windowEnd: Math.floor(T0 / 1000) - 40 * 86400 }).returning({ id: syncRuns.id }).get();
    db2.insert(balanceSnapshots).values({ accountId: "OLD1", syncRunId: run2.id, balanceCents: 12345, balanceDate: Math.floor(T0 / 1000) - 40 * 86400, recordedAt: iso(40) }).run();
    const series = netWorthSeries(db2, 7, T0);
    const cad = series.find((s) => s.currency === "CAD")!;
    expect(cad.points).toEqual([{ date: "2026-09-02", balanceCents: 12345 }]);
  });
});

describe("transactions", () => {
  it("lists newest first with account info and effective date, excluding hidden", () => {
    const { rows, total } = listTransactions(db);
    expect(total).toBe(7);
    expect(rows[0].id).toBe("t7"); // pending today
    expect(rows[0].accountName).toBe("Chequing");
    expect(rows[0].currency).toBe("CAD");
    expect(rows.map((r) => r.id)).not.toContain("t6");
  });
  it("filters by account, text, and date range", () => {
    expect(listTransactions(db, { accountId: "VISA" }).rows.map((r) => r.id)).toEqual(["t4", "t5"]);
    expect(listTransactions(db, { q: "coffee" }).rows.map((r) => r.id)).toEqual(["t2"]);
    expect(listTransactions(db, { q: "Employer" }).rows.map((r) => r.id)).toEqual(["t3"]);
    expect(listTransactions(db, { from: "2026-09-06", to: "2026-09-08" }).rows.map((r) => r.id)).toEqual(["t1", "t2", "t3"]);
  });
  it("filters dates on local_date rather than the UTC instant", () => {
    // 03:30Z on the 9th is still the 8th in America/Toronto. Every bucketed query and the
    // Spending by-category drill-down links go by local_date, so the list has to agree with them
    // or the drill-down count disagrees with the rows it lands on.
    db.update(transactions)
      .set({ posted: Math.floor(Date.UTC(2026, 8, 9, 3, 30) / 1000), localDate: "2026-09-08" })
      .where(eq(transactions.id, "t1"))
      .run();
    expect(listTransactions(db, { from: "2026-09-08", to: "2026-09-08" }).rows.map((r) => r.id)).toContain("t1");
    expect(listTransactions(db, { from: "2026-09-09", to: "2026-09-09" }).rows.map((r) => r.id)).not.toContain("t1");
  });
  it("paginates", () => {
    const p1 = listTransactions(db, { page: 1, pageSize: 3 });
    const p2 = listTransactions(db, { page: 2, pageSize: 3 });
    expect(p1.rows).toHaveLength(3);
    expect(p2.rows).toHaveLength(3);
    expect(p1.rows[0].id).not.toBe(p2.rows[0].id);
    expect(p1.total).toBe(7);
  });
  it("recentTransactions limits", () => {
    expect(recentTransactions(db, 2)).toHaveLength(2);
  });
  it("escapes % and _ wildcards in search while still matching plain text", () => {
    const day = (n: number) => Math.floor(T0 / 1000) - n * 86400;
    const iso = (n: number) => new Date(T0 - n * 86400 * 1000).toISOString();
    db.insert(transactions)
      .values([
        { id: "t9", accountId: "CHQ", posted: day(1), transactedAt: null, amountCents: -100, description: "SAVE 50% TODAY", payee: null, memo: null, pending: false, raw: "{}", firstSeenAt: iso(1), lastSeenAt: iso(0) },
        { id: "t10", accountId: "CHQ", posted: day(1), transactedAt: null, amountCents: -100, description: "FOO_BAR CHARGE", payee: null, memo: null, pending: false, raw: "{}", firstSeenAt: iso(1), lastSeenAt: iso(0) },
      ])
      .run();
    expect(listTransactions(db, { q: "%" }).rows.map((r) => r.id)).toEqual(["t9"]);
    expect(listTransactions(db, { q: "_" }).rows.map((r) => r.id)).toEqual(["t10"]);
    expect(listTransactions(db, { q: "coffee" }).rows.map((r) => r.id)).toEqual(["t2"]);
  });
  it("coerces invalid pagination and ignores unparsable date filters", () => {
    const r = listTransactions(db, { page: NaN, pageSize: Number("abc") });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(50);
    expect(r.total).toBe(7);
    expect(r.rows).toHaveLength(7);
    expect(listTransactions(db, { from: "last week" }).rows).toHaveLength(7);
  });
});

describe("spending", () => {
  it("groups by day with outflow and inflow, excluding hidden accounts", () => {
    const rows = spendingByPeriod(db, { days: 7, granularity: "day", today: TODAY });
    const cad = rows.filter((r) => r.currency === "CAD");
    expect(cad).toEqual([
      { period: "2026-09-06", currency: "CAD", outflowCents: 0, inflowCents: 250000 },
      { period: "2026-09-07", currency: "CAD", outflowCents: 1200, inflowCents: 0 },
      { period: "2026-09-08", currency: "CAD", outflowCents: 4510, inflowCents: 0 },
      { period: "2026-09-09", currency: "CAD", outflowCents: 500, inflowCents: 0 },
    ]);
    expect(rows.find((r) => r.currency === "USD")).toEqual({ period: "2026-09-04", currency: "USD", outflowCents: 1000, inflowCents: 0 });
  });
  it("groups by month", () => {
    const rows = spendingByPeriod(db, { days: 60, granularity: "month", today: TODAY }).filter((r) => r.currency === "CAD");
    expect(rows).toEqual([
      { period: "2026-07", currency: "CAD", outflowCents: 30000, inflowCents: 0 },
      { period: "2026-08", currency: "CAD", outflowCents: 8000, inflowCents: 0 },
      { period: "2026-09", currency: "CAD", outflowCents: 6210, inflowCents: 250000 },
    ]);
  });
  it("groups by ISO week", () => {
    const rows = spendingByPeriod(db, { days: 7, granularity: "week", today: TODAY }).filter((r) => r.currency === "CAD");
    expect(rows.map((r) => r.period)).toEqual(["2026-W36", "2026-W37"]);
  });
  it("ranks payees by outflow", () => {
    const top = topPayees(db, { days: 30, limit: 2, today: TODAY });
    expect(top[0]).toEqual({ label: "Gas", currency: "CAD", outflowCents: 8000, count: 1 });
    expect(top[1]).toEqual({ label: "Grocery Mart", currency: "CAD", outflowCents: 4510, count: 1 });
  });
  it("ranks payees per currency rather than globally", () => {
    const top = topPayees(db, { days: 30, limit: 1, today: TODAY });
    expect(top.find((t) => t.currency === "CAD")).toEqual({ label: "Gas", currency: "CAD", outflowCents: 8000, count: 1 });
    expect(top.find((t) => t.currency === "USD")).toEqual({ label: "Usd Shop", currency: "USD", outflowCents: 1000, count: 1 });
  });
});

describe("transactions with meta", () => {
  it("joins category and transfer state, hides transfers when asked", () => {
    seedTransferPair(db);
    const cat = createCategory(db, { name: "Groceries", kind: "expense" });
    setCategory(db, "t1", cat.id);
    setTransfer(db, "xfer-out", true);
    const all = listTransactions(db, { pageSize: 100 }).rows;
    const t1 = all.find((r) => r.id === "t1")!;
    expect(t1).toMatchObject({ categoryId: cat.id, categoryName: "Groceries", categorySource: "manual", isTransfer: false, localDate: "2026-09-08" });
    expect(all.find((r) => r.id === "xfer-out")).toMatchObject({ isTransfer: true, transferSource: "manual" });
    const hidden = listTransactions(db, { pageSize: 100, hideTransfers: true }).rows;
    expect(hidden.find((r) => r.id === "xfer-out")).toBeUndefined();
    expect(hidden.length).toBe(all.length - 1);
  });
  it("filters by category and by 'none'", () => {
    const cat = createCategory(db, { name: "Groceries", kind: "expense" });
    setCategory(db, "t1", cat.id);
    expect(listTransactions(db, { categoryId: cat.id }).rows.map((r) => r.id)).toEqual(["t1"]);
    const none = listTransactions(db, { categoryId: "none", pageSize: 100 }).rows.map((r) => r.id);
    expect(none).not.toContain("t1");
    expect(none).toContain("t2");
  });
});

describe("spending by local_date", () => {
  it("buckets by local day and excludes transfers", () => {
    seedTransferPair(db);
    setTransfer(db, "xfer-out", true);
    const rows = spendingByPeriod(db, { days: 30, granularity: "day", today: TODAY }).filter((r) => r.currency === "CAD");
    const day5 = rows.find((r) => r.period === "2026-09-04");
    expect(day5).toBeUndefined(); // the only CAD activity on that day was the transfer out
    expect(rows.find((r) => r.period === "2026-09-08")).toMatchObject({ outflowCents: 4510 });
  });
  it("month granularity uses YYYY-MM and week uses ISO weeks", () => {
    const m = spendingByPeriod(db, { days: 60, granularity: "month", today: TODAY }).filter((r) => r.currency === "CAD");
    expect(m.map((r) => r.period)).toEqual(["2026-07", "2026-08", "2026-09"]);
    const w = spendingByPeriod(db, { days: 7, granularity: "week", today: TODAY }).filter((r) => r.currency === "CAD");
    expect(w[0].period).toMatch(/^2026-W\d\d$/);
  });
  it("topPayees excludes transfers and respects sinceDate", () => {
    seedTransferPair(db);
    setTransfer(db, "xfer-out", true);
    const p = topPayees(db, { days: 30, today: TODAY });
    expect(p.map((x) => x.label)).not.toContain("TRANSFER TO SAVINGS");
    expect(topPayees(db, { days: 30, today: TODAY, sinceDate: TODAY }).filter((x) => x.currency === "CAD").map((x) => x.label)).toEqual(["Snack"]);
  });
  it("spendingByCategory groups outflows with Uncategorised for null", () => {
    const cat = createCategory(db, { name: "Groceries", kind: "expense" });
    setCategory(db, "t1", cat.id);
    const rows = spendingByCategory(db, { sinceDate: "2026-08-10" }).filter((r) => r.currency === "CAD");
    expect(rows[0]).toMatchObject({ categoryId: null, name: "Uncategorised" });
    expect(rows.find((r) => r.categoryId === cat.id)).toMatchObject({ outflowCents: 4510, count: 1 });
    const uncategorised = rows.find((r) => r.categoryId === null)!;
    expect(uncategorised.outflowCents).toBe(1200 + 8000 + 500); // t2, t4, t7 (pending counts), not t6 (hidden)
  });
});

describe("syncRuns", () => {
  it("lists and gets runs", () => {
    expect(listSyncRuns(db)).toHaveLength(1);
    expect(getSyncRun(db, runId)?.status).toBe("success");
    expect(getSyncRun(db, 999)).toBeUndefined();
  });
  it("reports status including credentials flag", () => {
    setState(db, STATE_KEYS.credentialsInvalid, { reason: "403", accessUrlHash: "x", at: "now" });
    setState(db, STATE_KEYS.lastSuccessfulSyncEnd, 123);
    const s = getSyncStatus(db);
    expect(s.latest?.id).toBe(runId);
    expect(s.lastSuccessfulSyncEnd).toBe(123);
    expect(s.credentialsInvalid?.reason).toBe("403");
    expect(s.latestErrlist).toEqual([]);
  });
});

describe("transactions know which debt they pay", () => {
  it("joins the debt name", () => {
    const { couchId } = seedDebts(db);
    linkTransaction(db, { debtId: couchId, transactionId: "t4" });
    const rows = listTransactions(db, { pageSize: 100 }).rows;
    expect(rows.find((r) => r.id === "t4")).toMatchObject({ debtId: couchId, debtName: "Couch" });
    expect(rows.find((r) => r.id === "t1")).toMatchObject({ debtId: null, debtName: null });
  });
});
