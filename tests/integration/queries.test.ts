import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic, T0 } from "../helpers/seed";
import type { Db } from "@/lib/db/client";
import { listAccounts, getAccount, totalsByCurrency, updateAccountSettings, displayName } from "@/lib/queries/accounts";
import { accountBalanceSeries, netWorthSeries } from "@/lib/queries/balances";
import { listTransactions, recentTransactions } from "@/lib/queries/transactions";
import { spendingByPeriod, topPayees } from "@/lib/queries/spending";
import { listSyncRuns, getSyncRun, getSyncStatus } from "@/lib/queries/syncRuns";
import { setState, STATE_KEYS } from "@/lib/db/appState";
import { accounts, balanceSnapshots, connections, syncRuns, transactions } from "@/lib/db/schema";

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
    const rows = spendingByPeriod(db, { days: 7, granularity: "day", nowMs: T0 });
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
    const rows = spendingByPeriod(db, { days: 60, granularity: "month", nowMs: T0 }).filter((r) => r.currency === "CAD");
    expect(rows).toEqual([
      { period: "2026-07", currency: "CAD", outflowCents: 30000, inflowCents: 0 },
      { period: "2026-08", currency: "CAD", outflowCents: 8000, inflowCents: 0 },
      { period: "2026-09", currency: "CAD", outflowCents: 6210, inflowCents: 250000 },
    ]);
  });
  it("groups by ISO week", () => {
    const rows = spendingByPeriod(db, { days: 7, granularity: "week", nowMs: T0 }).filter((r) => r.currency === "CAD");
    expect(rows.map((r) => r.period)).toEqual(["2026-W36", "2026-W37"]);
  });
  it("ranks payees by outflow", () => {
    const top = topPayees(db, { days: 30, limit: 2, nowMs: T0 });
    expect(top[0]).toEqual({ label: "Gas", currency: "CAD", outflowCents: 8000, count: 1 });
    expect(top[1]).toEqual({ label: "Grocery Mart", currency: "CAD", outflowCents: 4510, count: 1 });
  });
  it("ranks payees per currency rather than globally", () => {
    const top = topPayees(db, { days: 30, limit: 1, nowMs: T0 });
    expect(top.find((t) => t.currency === "CAD")).toEqual({ label: "Gas", currency: "CAD", outflowCents: 8000, count: 1 });
    expect(top.find((t) => t.currency === "USD")).toEqual({ label: "Usd Shop", currency: "USD", outflowCents: 1000, count: 1 });
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
