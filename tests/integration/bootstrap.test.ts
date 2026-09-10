import { describe, it, expect } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { seedBasic } from "../helpers/seed";
import { runDataSteps, BOOTSTRAP_VERSION } from "@/lib/db/bootstrap";
import { categories, connectionSyncState, transactions } from "@/lib/db/schema";
import { getState, setState, STATE_KEYS } from "@/lib/db/appState";
import { toLocalDate } from "@/lib/time";

const TZ = "America/Toronto";

describe("runDataSteps", () => {
  it("backfills local_date, seeds categories and connection state, records version and timezone", () => {
    const db = makeTestDb();
    seedBasic(db);
    db.update(transactions).set({ localDate: null }).run();
    setState(db, STATE_KEYS.lastSuccessfulSyncEnd, 1_757_400_000);
    const r = runDataSteps(db, { timezone: TZ });
    expect(r).toMatchObject({ localDatesBackfilled: 8, categoriesSeeded: 12, connectionsSeeded: 1, timezoneRecomputed: false, version: BOOTSTRAP_VERSION });
    expect(db.select().from(transactions).where(isNull(transactions.localDate)).all()).toHaveLength(0);
    const t1 = db.select().from(transactions).where(eq(transactions.id, "t1")).get()!;
    expect(t1.localDate).toBe(toLocalDate(t1.posted, TZ));
    expect(db.select().from(connectionSyncState).get()).toMatchObject({ connectionId: "org-1", lastSuccessEnd: 1_757_400_000 });
    expect(getState(db, STATE_KEYS.timezone)).toBe(TZ);
    expect(getState(db, STATE_KEYS.bootstrapVersion)).toBe(BOOTSTRAP_VERSION);
  });
  it("is a no-op the second time", () => {
    const db = makeTestDb();
    seedBasic(db);
    runDataSteps(db, { timezone: TZ });
    db.insert(categories).values({ name: "Custom", kind: "expense", sortOrder: 99, createdAt: "x", updatedAt: "x" }).run();
    const r = runDataSteps(db, { timezone: TZ });
    expect(r).toMatchObject({ localDatesBackfilled: 0, categoriesSeeded: 0, connectionsSeeded: 0, timezoneRecomputed: false });
    expect(db.select().from(categories).all()).toHaveLength(13);
  });
  it("does not seed categories when the owner already has some", () => {
    const db = makeTestDb();
    db.insert(categories).values({ name: "Mine", kind: "expense", sortOrder: 0, createdAt: "x", updatedAt: "x" }).run();
    expect(runDataSteps(db, { timezone: TZ }).categoriesSeeded).toBe(0);
  });
  it("recomputes every local_date when the timezone changes, then re-tags", () => {
    const db = makeTestDb();
    seedBasic(db);
    runDataSteps(db, { timezone: TZ }); // stored tz = America/Toronto
    // 03:30Z on the 9th is still the 8th in Toronto but already the 9th in UTC.
    db.update(transactions).set({ posted: Date.UTC(2026, 8, 9, 3, 30) / 1000 }).where(eq(transactions.id, "t1")).run();
    runDataSteps(db, { timezone: TZ });
    // Unchanged: only null rows are backfilled when the timezone has not changed.
    expect(db.select().from(transactions).where(eq(transactions.id, "t1")).get()!.localDate).toBe("2026-09-08");
    const r = runDataSteps(db, { timezone: "UTC" });
    expect(r.timezoneRecomputed).toBe(true);
    expect(db.select().from(transactions).where(eq(transactions.id, "t1")).get()!.localDate).toBe("2026-09-09");
    expect(getState(db, STATE_KEYS.timezone)).toBe("UTC");
    expect(getState(db, STATE_KEYS.lastTagging)).toBeDefined();
  });
});
