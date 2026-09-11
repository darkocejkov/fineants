import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { makeFetchMock, jsonResponse } from "../helpers/fetch";
import { runSync, RATE_GUARD_SECONDS, hashAccessUrl } from "@/lib/sync/engine";
import { accounts, transactions, balanceSnapshots, syncRuns, connections, connectionSyncState } from "@/lib/db/schema";
import { getState, setState, STATE_KEYS } from "@/lib/db/appState";
import { DAY } from "@/lib/sync/windows";
import { advanceWatermark, ensureConnectionState } from "@/lib/queries/connectionState";
import { toLocalDate } from "@/lib/time";

const ACCESS = "https://u:p@bridge.example/simplefin";
const NOW_MS = 1_757_400_000_000;
const fixture = (n: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "simplefin", n), "utf8"));

function deps(db = makeTestDb(), handler = () => jsonResponse(fixture("old-shape.json")), nowMs = NOW_MS) {
  const fetchImpl = makeFetchMock(handler);
  return { db, fetchImpl, d: { db, accessUrl: ACCESS, backfillDays: 365, fetchImpl, now: () => nowMs, timezone: "America/Toronto" } };
}

// old-shape.json's legacy error ("Connection to Example Bank may need attention") is attributed
// by name to its single connection (org-1). Per-connection watermarks mean an attributed error
// holds that connection's watermark at null, which forces a full backfill on the next sync. Tests
// that assert a single incremental window on a follow-up run need a healthy (errorless) copy of
// the fixture so the connection actually advances, matching pre-per-connection-watermark behaviour.
function oldShapeHealthy() {
  const f = fixture("old-shape.json");
  f.errors = [];
  return f;
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
    const { db, d } = deps(makeTestDb(), () => jsonResponse(oldShapeHealthy()));
    await runSync(d, { trigger: "cli" });
    const later = NOW_MS + 6 * 3600 * 1000;
    const updated = oldShapeHealthy();
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
    const { db, d } = deps(makeTestDb(), () => jsonResponse(oldShapeHealthy()));
    await runSync(d, { trigger: "cli" });
    const without = oldShapeHealthy();
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
    const seeded = oldShapeHealthy();
    seeded.accounts[0].transactions[1] = { id: "TX-2", posted: 1757395000, amount: "-12.00", description: "COFFEE", payee: "Coffee", memo: "", pending: true };
    await runSync({ ...d, fetchImpl: makeFetchMock(() => jsonResponse(seeded)) }, { trigger: "cli" });
    const vanished = oldShapeHealthy();
    vanished.accounts[0].transactions = [vanished.accounts[0].transactions[0]];
    const r = await runSync({ ...d, fetchImpl: makeFetchMock(() => jsonResponse(vanished)), now: () => NOW_MS + 7 * 3600 * 1000 }, { trigger: "cli" });
    expect(r.runs[0].pendingRemoved).toBe(1);
    expect(db.select().from(transactions).where(eq(transactions.id, "TX-2")).get()).toBeUndefined();
  });
  it("does not delete a pending row whose effective date falls outside the window", async () => {
    const { db, d } = deps();
    const seeded = oldShapeHealthy();
    seeded.accounts[0].transactions[1] = { id: "TX-2", posted: 946684800, amount: "-12.00", description: "OLD PENDING", payee: "Coffee", memo: "", pending: true };
    await runSync({ ...d, fetchImpl: makeFetchMock(() => jsonResponse(seeded)) }, { trigger: "cli" });
    const vanished = oldShapeHealthy();
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
    const { d, fetchImpl } = deps(makeTestDb(), () => jsonResponse(oldShapeHealthy()));
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
    const r = await runSync({ db: throwing, accessUrl: ACCESS, backfillDays: 365, fetchImpl, now: () => NOW_MS, timezone: "America/Toronto" }, { trigger: "cli" });

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

describe("runSync per-connection watermarks", () => {
  it("writes local_date for every upserted transaction", async () => {
    const { db, d } = deps();
    await runSync(d, { trigger: "cli" });
    const tx = db.select().from(transactions).where(eq(transactions.id, "TX-1")).get()!;
    expect(tx.localDate).toBe(toLocalDate(1757300000, "America/Toronto"));
  });
  it("advances only the connections without an attributed error (new shape, conn_id)", async () => {
    const { db, d } = deps(makeTestDb(), () => jsonResponse(fixture("two-connections.json")));
    const r = await runSync(d, { trigger: "cli" });
    expect(r.runs.at(-1)!.status).toBe("partial");
    const states = Object.fromEntries(db.select().from(connectionSyncState).all().map((s) => [s.connectionId, s]));
    expect(states["conn-tang"].lastSuccessEnd).toBe(Math.floor(NOW_MS / 1000));
    expect(states["conn-td"].lastSuccessEnd).toBeNull();
    expect(states["conn-td"].lastErrorCode).toBe("con.auth");
    expect(states["conn-tang"].lastErrorCode).toBeNull();
    // Stored errlist carries the attribution for the explorer.
    const run = db.select().from(syncRuns).orderBy(syncRuns.id).all().at(-1)!;
    expect(JSON.parse(run.errlist)[0].attributedConnectionId).toBe("conn-td");
  });
  it("attributes a legacy error by the connection name in its message", async () => {
    const { db, d } = deps(makeTestDb(), () => jsonResponse(fixture("two-connections-legacy.json")));
    await runSync(d, { trigger: "cli" });
    const states = Object.fromEntries(db.select().from(connectionSyncState).all().map((s) => [s.connectionId, s]));
    expect(states["org-tang"].lastSuccessEnd).toBe(Math.floor(NOW_MS / 1000));
    expect(states["org-td"].lastSuccessEnd).toBeNull();
    expect(states["org-td"].lastErrorMsg).toMatch(/Auth required/);
  });
  it("an unattributed error holds every connection", async () => {
    const body = fixture("two-connections.json");
    body.errlist = [{ code: "gen.other", msg: "Bridge is having a bad day" }];
    const { db, d } = deps(makeTestDb(), () => jsonResponse(body));
    await runSync(d, { trigger: "cli" });
    const states = db.select().from(connectionSyncState).all();
    expect(states.every((s) => s.lastSuccessEnd === null)).toBe(true);
    expect(states.every((s) => s.lastErrorCode === "gen.other")).toBe(true);
  });
  it("the next window starts from the oldest watermark, so a recovered connection's gap is fetched", async () => {
    // Run 1: TD errored, Tangerine advanced.
    const { db, d } = deps(makeTestDb(), () => jsonResponse(fixture("two-connections.json")));
    await runSync(d, { trigger: "cli" });
    // Run 2, 10 days later, TD is healthy. Window must reach back to the full backfill (TD never succeeded).
    const healthy = fixture("two-connections.json");
    healthy.errlist = [];
    const fetchImpl = makeFetchMock(() => jsonResponse(healthy));
    const later = NOW_MS + 10 * DAY * 1000;
    const r = await runSync({ ...d, fetchImpl, now: () => later }, { trigger: "scheduled" });
    const first = new URL(fetchImpl.calls[0].url);
    expect(Number(first.searchParams.get("start-date"))).toBe(Math.floor(later / 1000) - 365 * DAY);
    expect(r.runs.every((x) => x.status === "success")).toBe(true);
    const states = db.select().from(connectionSyncState).all();
    expect(states.every((s) => s.lastSuccessEnd === Math.floor(later / 1000))).toBe(true);
    expect(states.every((s) => s.lastErrorCode === null)).toBe(true);
  });
  it("uses the oldest healthy watermark when every connection has one", async () => {
    const healthy = fixture("two-connections.json");
    healthy.errlist = [];
    const { db, d } = deps(makeTestDb(), () => jsonResponse(healthy));
    await runSync(d, { trigger: "cli" });
    // Push Tangerine's watermark back 20 days by hand; the next window must start there minus overlap.
    const twentyAgo = Math.floor(NOW_MS / 1000) - 20 * DAY;
    db.update(connectionSyncState).set({ lastSuccessEnd: twentyAgo }).where(eq(connectionSyncState.connectionId, "conn-tang")).run();
    const fetchImpl = makeFetchMock(() => jsonResponse(healthy));
    await runSync({ ...d, fetchImpl, now: () => NOW_MS + 3600 * 1000 }, { trigger: "cli", force: true });
    const first = new URL(fetchImpl.calls[0].url);
    expect(Number(first.searchParams.get("start-date"))).toBe(twentyAgo - 5 * DAY);
  });
  it("seeds a brand-new connection's state from the global watermark rather than forcing a full backfill", async () => {
    // old-shape's error attributes to org-1 by name; use a healthy copy so org-1 advances to a
    // real watermark on this first sync, otherwise it stays null and forces a full backfill below
    // (see the "recovered connection" test above for that scenario, which is intentional there).
    const { db, d } = deps(makeTestDb(), () => jsonResponse(oldShapeHealthy()));
    await runSync(d, { trigger: "cli" }); // old-shape: one connection org-1
    const later = NOW_MS + 6 * 3600 * 1000;
    const fetchImpl = makeFetchMock(() => jsonResponse(fixture("two-connections.json")));
    await runSync({ ...d, fetchImpl, now: () => later }, { trigger: "cli" });
    const first = new URL(fetchImpl.calls[0].url);
    expect(Number(first.searchParams.get("start-date"))).toBe(Math.floor(NOW_MS / 1000) - 5 * DAY);
    expect(db.select().from(connectionSyncState).all()).toHaveLength(3);
    // Verify the seeding design: new connections get the global watermark, not null.
    // conn-tang is healthy so it advances to the new window end; conn-td has an attributed error
    // so it is held at the seeded value (the global watermark from run 1).
    const states = Object.fromEntries(db.select().from(connectionSyncState).all().map((s) => [s.connectionId, s]));
    expect(states["conn-tang"].lastSuccessEnd).toBe(Math.floor(later / 1000));
    expect(states["conn-td"].lastSuccessEnd).toBe(Math.floor(NOW_MS / 1000));
  });
  it("sweeps a stale running row before starting", async () => {
    const { db, d } = deps();
    db.insert(syncRuns).values({ trigger: "cli", status: "running", startedAt: new Date(NOW_MS - 3600 * 1000).toISOString(), windowStart: 0, windowEnd: 1 }).run();
    await runSync(d, { trigger: "cli" });
    const swept = db.select().from(syncRuns).orderBy(syncRuns.id).all()[0];
    expect(swept).toMatchObject({ status: "failed", error: "interrupted" });
  });
});

describe("runSync watermarks across a multi-window run", () => {
  it("holds a connection that errored in any window even when a later window comes back clean", async () => {
    // 120 backfill days splits into two windows (90 + the remainder). conn-td errors in the
    // first window only; advancing it to the second window's end would silently skip the first.
    const healthy = fixture("two-connections.json");
    healthy.errlist = [];
    let call = 0;
    const { db, fetchImpl, d } = deps(makeTestDb(), () => jsonResponse(++call === 1 ? fixture("two-connections.json") : healthy));
    const r = await runSync({ ...d, backfillDays: 120 }, { trigger: "cli" });
    expect(fetchImpl.calls).toHaveLength(2);
    expect(r.runs.map((x) => x.status)).toEqual(["partial", "success"]);
    const states = Object.fromEntries(db.select().from(connectionSyncState).all().map((s) => [s.connectionId, s]));
    expect(states["conn-td"].lastSuccessEnd).toBeNull();
    expect(states["conn-td"].lastErrorCode).toBe("con.auth");
    expect(states["conn-tang"].lastSuccessEnd).toBe(Math.floor(NOW_MS / 1000));
    expect(states["conn-tang"].lastErrorCode).toBeNull();
  });
  it("advanceWatermark never moves a watermark backwards", () => {
    const db = makeTestDb();
    const stamp = new Date(NOW_MS).toISOString();
    db.insert(connections).values({ id: "conn-1", name: "Bank", raw: "{}", firstSeenAt: stamp, lastSeenAt: stamp }).run();
    const ahead = Math.floor(NOW_MS / 1000);
    ensureConnectionState(db, "conn-1", ahead);
    advanceWatermark(db, "conn-1", ahead - 10 * DAY);
    expect(db.select().from(connectionSyncState).get()!.lastSuccessEnd).toBe(ahead);
    advanceWatermark(db, "conn-1", ahead + DAY);
    expect(db.select().from(connectionSyncState).get()!.lastSuccessEnd).toBe(ahead + DAY);
  });
});

describe("runSync tagging hook", () => {
  it("runs the tagging pass after a sync that upserted rows and reports it", async () => {
    const { db, d } = deps();
    const r = await runSync(d, { trigger: "cli" });
    expect(r.tagging).toBeDefined();
    expect(r.tagging!.durationMs).toBeGreaterThanOrEqual(0);
    expect(getState(db, STATE_KEYS.lastTagging)).toBeDefined();
  });
  it("skips tagging when nothing was upserted", async () => {
    // old-shape.json's attributed error holds its connection's watermark at null, which would
    // force the second run back into a five-window full backfill. Use the healthy copy for both
    // runs so the connection actually advances and the second run is a single window.
    const { db, d } = deps(makeTestDb(), () => jsonResponse(oldShapeHealthy()));
    await runSync(d, { trigger: "cli" });
    const empty = oldShapeHealthy();
    empty.accounts.forEach((a: { transactions: unknown[] }) => (a.transactions = []));
    const r = await runSync({ ...d, fetchImpl: makeFetchMock(() => jsonResponse(empty)), now: () => NOW_MS + 7 * 3600 * 1000 }, { trigger: "cli" });
    expect(r.tagging).toBeUndefined();
    void db;
  });
});
