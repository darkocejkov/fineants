import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { makeFetchMock, jsonResponse } from "../helpers/fetch";
import { runSync, RATE_GUARD_SECONDS, hashAccessUrl } from "@/lib/sync/engine";
import { accounts, transactions, balanceSnapshots, syncRuns, connections } from "@/lib/db/schema";
import { getState, setState, STATE_KEYS } from "@/lib/db/appState";
import { DAY } from "@/lib/sync/windows";

const ACCESS = "https://u:p@bridge.example/simplefin";
const NOW_MS = 1_757_400_000_000;
const fixture = (n: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "simplefin", n), "utf8"));

function deps(db = makeTestDb(), handler = () => jsonResponse(fixture("old-shape.json")), nowMs = NOW_MS) {
  const fetchImpl = makeFetchMock(handler);
  return { db, fetchImpl, d: { db, accessUrl: ACCESS, backfillDays: 365, fetchImpl, now: () => nowMs } };
}

describe("runSync first backfill", () => {
  it("issues one request per window and stores everything", async () => {
    const { db, fetchImpl, d } = deps();
    const result = await runSync(d, { trigger: "cli" });
    expect(result.skipped).toBeUndefined();
    expect(result.runs).toHaveLength(5);
    expect(fetchImpl.calls).toHaveLength(5);
    expect(result.runs.every((r) => r.status === "partial")).toBe(true); // fixture has a legacy error
    expect(db.select().from(connections).all()).toHaveLength(1);
    expect(db.select().from(accounts).all()).toHaveLength(2);
    expect(db.select().from(transactions).all()).toHaveLength(2);
    expect(db.select().from(balanceSnapshots).all()).toHaveLength(10); // 2 accounts x 5 runs
    const runs = db.select().from(syncRuns).all();
    expect(runs).toHaveLength(5);
    expect(runs[0].rawResponse).toContain("Everyday Chequing");
    expect(JSON.parse(runs[0].errlist)[0].code).toBe("gen.legacy");
    expect(getState<number>(db, STATE_KEYS.lastSuccessfulSyncEnd)).toBe(Math.floor(NOW_MS / 1000));
    const first = new URL(fetchImpl.calls[0].url);
    expect(Number(first.searchParams.get("start-date"))).toBe(Math.floor(NOW_MS / 1000) - 365 * DAY);
  });
  it("returns no_access_url when unset", async () => {
    const { d } = deps();
    const r = await runSync({ ...d, accessUrl: undefined }, { trigger: "cli" });
    expect(r.skipped).toBe("no_access_url");
    expect(r.runs).toEqual([]);
  });
});

describe("runSync incremental", () => {
  it("makes one request from last success minus overlap and updates pending -> posted in place", async () => {
    const { db, d } = deps();
    await runSync(d, { trigger: "cli" });
    const later = NOW_MS + 6 * 3600 * 1000;
    const updated = fixture("old-shape.json");
    updated.accounts[0].transactions[1] = { id: "TX-2", posted: 1757395000, amount: "-12.00", description: "COFFEE", payee: "Coffee", memo: "" };
    updated.accounts[0].balance = "1511.44";
    const fetchImpl = makeFetchMock(() => jsonResponse(updated));
    const r = await runSync({ ...d, fetchImpl, now: () => later }, { trigger: "scheduled" });
    expect(r.runs).toHaveLength(1);
    expect(fetchImpl.calls).toHaveLength(1);
    const u = new URL(fetchImpl.calls[0].url);
    expect(Number(u.searchParams.get("start-date"))).toBe(Math.floor(NOW_MS / 1000) - 5 * DAY);
    const tx2 = db.select().from(transactions).where(eq(transactions.id, "TX-2")).get()!;
    expect(tx2.pending).toBe(false);
    expect(tx2.posted).toBe(1757395000);
    expect(db.select().from(accounts).where(eq(accounts.id, "ACC-1")).get()!.balanceCents).toBe(151144);
    expect(db.select().from(transactions).all()).toHaveLength(2);
  });
  it("preserves user-set account fields across syncs", async () => {
    const { db, d } = deps();
    await runSync(d, { trigger: "cli" });
    db.update(accounts).set({ nickname: "Main", type: "checking", hidden: true }).where(eq(accounts.id, "ACC-1")).run();
    await runSync({ ...d, now: () => NOW_MS + 7 * 3600 * 1000 }, { trigger: "cli" });
    const a = db.select().from(accounts).where(eq(accounts.id, "ACC-1")).get()!;
    expect(a.nickname).toBe("Main");
    expect(a.type).toBe("checking");
    expect(a.hidden).toBe(true);
  });
  it("deletes pending transactions that vanished", async () => {
    const { db, d } = deps();
    await runSync(d, { trigger: "cli" });
    const without = fixture("old-shape.json");
    without.accounts[0].transactions = [without.accounts[0].transactions[0]];
    const r = await runSync({ ...d, fetchImpl: makeFetchMock(() => jsonResponse(without)), now: () => NOW_MS + 7 * 3600 * 1000 }, { trigger: "cli" });
    expect(r.runs[0].pendingRemoved).toBe(1);
    expect(db.select().from(transactions).where(eq(transactions.id, "TX-2")).get()).toBeUndefined();
    expect(db.select().from(transactions).where(eq(transactions.id, "TX-1")).get()).toBeDefined();
  });
});

describe("runSync pending reconciliation by effective date", () => {
  it("deletes a pending row dated by posted (no transacted_at) once it vanishes inside the window", async () => {
    const { db, d } = deps();
    const seeded = fixture("old-shape.json");
    seeded.accounts[0].transactions[1] = { id: "TX-2", posted: 1757395000, amount: "-12.00", description: "COFFEE", payee: "Coffee", memo: "", pending: true };
    await runSync({ ...d, fetchImpl: makeFetchMock(() => jsonResponse(seeded)) }, { trigger: "cli" });
    const vanished = fixture("old-shape.json");
    vanished.accounts[0].transactions = [vanished.accounts[0].transactions[0]];
    const r = await runSync({ ...d, fetchImpl: makeFetchMock(() => jsonResponse(vanished)), now: () => NOW_MS + 7 * 3600 * 1000 }, { trigger: "cli" });
    expect(r.runs[0].pendingRemoved).toBe(1);
    expect(db.select().from(transactions).where(eq(transactions.id, "TX-2")).get()).toBeUndefined();
  });
  it("does not delete a pending row whose effective date falls outside the window", async () => {
    const { db, d } = deps();
    const seeded = fixture("old-shape.json");
    seeded.accounts[0].transactions[1] = { id: "TX-2", posted: 946684800, amount: "-12.00", description: "OLD PENDING", payee: "Coffee", memo: "", pending: true };
    await runSync({ ...d, fetchImpl: makeFetchMock(() => jsonResponse(seeded)) }, { trigger: "cli" });
    const vanished = fixture("old-shape.json");
    vanished.accounts[0].transactions = [vanished.accounts[0].transactions[0]];
    const r = await runSync({ ...d, fetchImpl: makeFetchMock(() => jsonResponse(vanished)), now: () => NOW_MS + 7 * 3600 * 1000 }, { trigger: "cli" });
    expect(r.runs[0].pendingRemoved).toBe(0);
    expect(db.select().from(transactions).where(eq(transactions.id, "TX-2")).get()).toBeDefined();
  });
  it("keeps a dateless pending row through earlier windows of a forced multi-window run, deleting it only in the newest window", async () => {
    const { db, d } = deps();
    const stamp = new Date(NOW_MS).toISOString();
    db.insert(connections).values({ id: "conn-seed", name: "Seed Bank", raw: "{}", firstSeenAt: stamp, lastSeenAt: stamp }).run();
    db.insert(accounts)
      .values({ id: "ACC-1", connectionId: "conn-seed", name: "Chequing", currency: "CAD", balanceCents: 100000, balanceDate: 1757400000, raw: "{}", firstSeenAt: stamp, lastSeenAt: stamp })
      .run();
    db.insert(transactions)
      .values({ id: "TX-DATELESS", accountId: "ACC-1", posted: 0, transactedAt: null, amountCents: -500, description: "PENDING NO DATE", pending: true, raw: "{}", firstSeenAt: stamp, lastSeenAt: stamp })
      .run();

    const r = await runSync(d, { trigger: "cli", force: true });
    expect(r.runs).toHaveLength(5);
    expect(r.runs.slice(0, 4).map((run) => run.pendingRemoved)).toEqual([0, 0, 0, 0]);
    expect(r.runs[4].pendingRemoved).toBe(1);
    expect(db.select().from(transactions).where(eq(transactions.id, "TX-DATELESS")).get()).toBeUndefined();
  });
});

describe("runSync guards and failures", () => {
  it("skips when last run started under 30 minutes ago unless forced", async () => {
    const { d, fetchImpl } = deps();
    await runSync(d, { trigger: "cli" });
    const soon = NOW_MS + (RATE_GUARD_SECONDS - 60) * 1000;
    const r1 = await runSync({ ...d, now: () => soon }, { trigger: "scheduled" });
    expect(r1.skipped).toBe("rate_limited");
    const r2 = await runSync({ ...d, now: () => soon }, { trigger: "manual", force: true });
    expect(r2.skipped).toBeUndefined();
    expect(fetchImpl.calls.length).toBe(6);
  });
  it("marks run failed and sets credentials_invalid on 403, then skips until access url changes", async () => {
    const { db, d } = deps(makeTestDb(), () => new Response("no", { status: 403 }));
    const r = await runSync(d, { trigger: "cli" });
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].status).toBe("failed");
    expect(r.runs[0].error).toMatch(/403/);
    expect(getState(db, STATE_KEYS.credentialsInvalid)).toBeDefined();
    const failedRun = db.select().from(syncRuns).get()!;
    expect(failedRun.httpStatus).toBe(403);
    expect(failedRun.rawResponse).toBe("no");
    const r2 = await runSync({ ...d, now: () => NOW_MS + DAY * 1000 }, { trigger: "scheduled" });
    expect(r2.skipped).toBe("credentials_invalid");
    const r3 = await runSync({ ...d, accessUrl: "https://u:new@bridge.example/simplefin", fetchImpl: makeFetchMock(() => jsonResponse(fixture("new-shape.json"))), now: () => NOW_MS + DAY * 1000 }, { trigger: "scheduled" });
    expect(r3.skipped).toBeUndefined();
    expect(getState(db, STATE_KEYS.credentialsInvalid)).toBeUndefined();
  });
  it("records http status and raw body on a 5xx failure", async () => {
    const { db, d } = deps(makeTestDb(), () => new Response("server exploded", { status: 500 }));
    const r = await runSync(d, { trigger: "cli" });
    expect(r.runs[0].status).toBe("failed");
    expect(r.runs[0].error).toMatch(/500/);
    const failedRun = db.select().from(syncRuns).get()!;
    expect(failedRun.httpStatus).toBe(500);
    expect(failedRun.rawResponse).toBe("server exploded");
  });
  it("records a failed run on network error and keeps going next time", async () => {
    let calls = 0;
    const { db, d } = deps(makeTestDb(), () => { calls++; if (calls === 1) throw new TypeError("fetch failed"); return jsonResponse(fixture("new-shape.json")); });
    const r = await runSync(d, { trigger: "cli" });
    expect(r.runs[0].status).toBe("failed");
    expect(r.runs).toHaveLength(1); // stops after first failure
    expect(getState(db, STATE_KEYS.lastSuccessfulSyncEnd)).toBeUndefined();
    const r2 = await runSync({ ...d, now: () => NOW_MS + 3600 * 1000 }, { trigger: "cli", force: true });
    expect(r2.runs.length).toBeGreaterThan(0);
    expect(r2.runs.every((x) => x.status === "partial")).toBe(true); // new-shape has con.auth errlist
  });
  it("stores raw body even when parse fails", async () => {
    const { db, d } = deps(makeTestDb(), () => new Response("<html>nope</html>", { status: 200 }));
    const r = await runSync(d, { trigger: "cli" });
    expect(r.runs[0].status).toBe("failed");
    expect(db.select().from(syncRuns).all()[0].rawResponse).toContain("<html>");
  });
  it("clears a stale credentials_invalid flag once a forced sync succeeds", async () => {
    const { db, d } = deps();
    setState(db, STATE_KEYS.credentialsInvalid, { reason: "stale", accessUrlHash: hashAccessUrl(ACCESS), at: new Date(0).toISOString() });
    const r = await runSync(d, { trigger: "manual", force: true });
    expect(r.skipped).toBeUndefined();
    expect(getState(db, STATE_KEYS.credentialsInvalid)).toBeUndefined();
    const r2 = await runSync({ ...d, now: () => NOW_MS + 7 * 3600 * 1000 }, { trigger: "scheduled" });
    expect(r2.skipped).toBeUndefined();
  });
});

describe("runSync when the database phase throws", () => {
  it("marks the run failed rather than leaving it running, and stops the loop", async () => {
    const real = makeTestDb();
    // The run row is inserted before the fetch and outside the transaction, so a throw inside
    // the transaction rolls back the writes while the row survives. Everything but
    // `transaction` reaches the real database, which is where the row is then read back from.
    const throwing = new Proxy(real, {
      get(target, prop) {
        if (prop === "transaction") {
          return () => {
            throw new Error("database or disk is full");
          };
        }
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as typeof real;

    const fetchImpl = makeFetchMock(() => jsonResponse(fixture("old-shape.json")));
    const r = await runSync({ db: throwing, accessUrl: ACCESS, backfillDays: 365, fetchImpl, now: () => NOW_MS }, { trigger: "cli" });

    expect(r.runs).toHaveLength(1); // the failure stops the remaining four windows
    expect(r.runs[0]).toMatchObject({ status: "failed", error: "database or disk is full" });
    expect(fetchImpl.calls).toHaveLength(1);

    const rows = real.select().from(syncRuns).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].finishedAt).toBe(new Date(NOW_MS).toISOString());
    expect(rows[0].error).toBe("database or disk is full");
    // Rolled back: no account, transaction or snapshot survived the failed transaction.
    expect(real.select().from(accounts).all()).toHaveLength(0);
    expect(real.select().from(balanceSnapshots).all()).toHaveLength(0);
    expect(getState(real, STATE_KEYS.lastSuccessfulSyncEnd)).toBeUndefined();
  });
});
