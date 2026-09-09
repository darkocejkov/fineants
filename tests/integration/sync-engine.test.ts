import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { makeFetchMock, jsonResponse } from "../helpers/fetch";
import { runSync, RATE_GUARD_SECONDS } from "@/lib/sync/engine";
import { accounts, transactions, balanceSnapshots, syncRuns, connections } from "@/lib/db/schema";
import { getState, STATE_KEYS } from "@/lib/db/appState";
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
    const r2 = await runSync({ ...d, now: () => NOW_MS + DAY * 1000 }, { trigger: "scheduled" });
    expect(r2.skipped).toBe("credentials_invalid");
    const r3 = await runSync({ ...d, accessUrl: "https://u:new@bridge.example/simplefin", fetchImpl: makeFetchMock(() => jsonResponse(fixture("new-shape.json"))), now: () => NOW_MS + DAY * 1000 }, { trigger: "scheduled" });
    expect(r3.skipped).toBeUndefined();
    expect(getState(db, STATE_KEYS.credentialsInvalid)).toBeUndefined();
  });
  it("records a failed run on network error and keeps going next time", async () => {
    let calls = 0;
    const { db, d } = deps(makeTestDb(), () => { calls++; if (calls === 1) throw new TypeError("fetch failed"); return jsonResponse(fixture("new-shape.json")); });
    const r = await runSync(d, { trigger: "cli" });
    expect(r.runs[0].status).toBe("failed");
    expect(r.runs).toHaveLength(1); // stops after first failure
    expect(getState(db, STATE_KEYS.lastSuccessfulSyncEnd)).toBeUndefined();
    const r2 = await runSync({ ...d, now: () => NOW_MS + 3600 * 1000 }, { trigger: "cli", force: true });
    expect(r2.runs.every((x) => r2.runs.length > 0 && x.status === "partial")).toBe(true); // new-shape has con.auth errlist
  });
  it("stores raw body even when parse fails", async () => {
    const { db, d } = deps(makeTestDb(), () => new Response("<html>nope</html>", { status: 200 }));
    const r = await runSync(d, { trigger: "cli" });
    expect(r.runs[0].status).toBe("failed");
    expect(db.select().from(syncRuns).all()[0].rawResponse).toContain("<html>");
  });
});
