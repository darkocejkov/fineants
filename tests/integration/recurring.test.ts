import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic } from "../helpers/seed";
import { seedRecurring, seedRecurringTransactions } from "../helpers/seed2b";
import type { Db } from "@/lib/db/client";
import {
  validateRecurringInput, listRecurringCosts, createRecurringCost, updateRecurringCost, setRecurringActive, deleteRecurringCost,
  listRecurringWithStatus, previewPatternMatches, upcomingRecurring, getRecurringCost,
} from "@/lib/queries/recurring";
import { setRecurring } from "@/lib/queries/meta";

let db: Db;
beforeEach(() => {
  db = makeTestDb();
  seedBasic(db);
});

const TODAY = "2026-09-09";

describe("validation and CRUD", () => {
  it("validates input", () => {
    const ok = { name: "Netflix", currency: "CAD", amountCents: 1699, cadence: "monthly" as const, anchorOn: "2026-09-12" };
    expect(validateRecurringInput(ok)).toBeNull();
    expect(validateRecurringInput({ ...ok, name: " " })).toMatch(/name/i);
    expect(validateRecurringInput({ ...ok, amountCents: 0 })).toMatch(/amount/i);
    expect(validateRecurringInput({ ...ok, anchorOn: "2026-9-1" })).toMatch(/date/i);
    expect(validateRecurringInput({ ...ok, cadence: "custom_days" })).toMatch(/interval/i);
    expect(validateRecurringInput({ ...ok, cadence: "custom_days", intervalDays: 45 })).toBeNull();
    expect(validateRecurringInput({ ...ok, matchToleranceBps: 20000 })).toMatch(/tolerance/i);
  });
  it("creates, updates, deactivates, deletes", () => {
    const c = createRecurringCost(db, { name: "Netflix", provider: "Netflix", currency: "CAD", amountCents: 1699, cadence: "monthly", anchorOn: "2026-09-12", matchPattern: "netflix" });
    expect(c.id).toBeGreaterThan(0);
    expect(getRecurringCost(db, c.id)?.matchToleranceBps).toBe(1000);
    updateRecurringCost(db, c.id, { name: "Netflix", currency: "CAD", amountCents: 1899, cadence: "monthly", anchorOn: "2026-09-12", matchPattern: null });
    expect(getRecurringCost(db, c.id)).toMatchObject({ amountCents: 1899, matchPattern: null });
    setRecurringActive(db, c.id, false);
    expect(listRecurringCosts(db)).toHaveLength(0);
    expect(listRecurringCosts(db, { includeInactive: true })).toHaveLength(1);
    deleteRecurringCost(db, c.id);
    expect(listRecurringCosts(db, { includeInactive: true })).toHaveLength(0);
  });
  it("rejects invalid input on create", () => {
    expect(() => createRecurringCost(db, { name: "", currency: "CAD", amountCents: 1, cadence: "weekly", anchorOn: "2026-09-01" })).toThrow(/name/i);
  });
});

describe("status", () => {
  it("reports due, paid via a linked transaction, and overdue", () => {
    const { spotifyId, rentId } = seedRecurring(db);
    seedRecurringTransactions(db);
    let rows = listRecurringWithStatus(db, { today: TODAY });
    const spotify = rows.find((r) => r.id === spotifyId)!;
    expect(spotify.dueOn).toBe("2026-09-05");
    expect(spotify.status).toBe("overdue"); // nothing linked yet; due date passed
    expect(spotify.monthlyEquivalentCents).toBe(1299);
    setRecurring(db, "sp-2", spotifyId);
    rows = listRecurringWithStatus(db, { today: TODAY });
    expect(rows.find((r) => r.id === spotifyId)).toMatchObject({ status: "paid", matched: { transactionId: "sp-2", localDate: "2026-09-05", amountCents: -1299 } });
    const rent = rows.find((r) => r.id === rentId)!;
    expect(rent.dueOn).toBe("2026-09-01");
    expect(rent.status).toBe("overdue");
    expect(listRecurringWithStatus(db, { today: "2026-08-30" }).find((r) => r.id === rentId)).toMatchObject({ dueOn: "2026-09-01", status: "due" });
  });
  it("sorts by due date then name and hides inactive by default", () => {
    const { rentId } = seedRecurring(db);
    setRecurringActive(db, rentId, false);
    const rows = listRecurringWithStatus(db, { today: TODAY });
    expect(rows.map((r) => r.name)).toEqual(["Spotify"]);
    expect(listRecurringWithStatus(db, { today: TODAY, includeInactive: true }).map((r) => r.name)).toEqual(["Rent", "Spotify"]);
  });
});

describe("previewPatternMatches", () => {
  it("counts outflows matching pattern and tolerance without writing", () => {
    seedRecurringTransactions(db);
    const r = previewPatternMatches(db, { currency: "CAD", amountCents: 1299, accountId: null, matchPattern: "spotify", matchToleranceBps: 1000 });
    expect(r.count).toBe(3); // sp-1, sp-2, sp-near (1250 is within 10%)
    expect(r.sample.map((s) => s.id)).toEqual(["sp-near", "sp-2", "sp-1"]); // newest first
    expect(previewPatternMatches(db, { currency: "CAD", amountCents: 1299, accountId: null, matchPattern: "spotify", matchToleranceBps: 100 }).count).toBe(2);
    expect(previewPatternMatches(db, { currency: "CAD", amountCents: 1299, accountId: "VISA", matchPattern: "spotify", matchToleranceBps: 1000 }).count).toBe(0);
    expect(previewPatternMatches(db, { currency: "CAD", amountCents: 1299, accountId: null, matchPattern: "  ", matchToleranceBps: 1000 }).count).toBe(0);
  });
});

describe("upcomingRecurring", () => {
  it("lists unpaid periods due within the window, including overdue ones", () => {
    const { spotifyId } = seedRecurring(db);
    let items = upcomingRecurring(db, { today: TODAY, days: 7 });
    expect(items.map((i) => [i.name, i.dueOn, i.status])).toEqual([["Rent", "2026-09-01", "overdue"], ["Spotify", "2026-09-05", "overdue"]]);
    seedRecurringTransactions(db);
    setRecurring(db, "sp-2", spotifyId);
    items = upcomingRecurring(db, { today: TODAY, days: 7 });
    expect(items.map((i) => i.name)).toEqual(["Rent"]);
    // 30 days ahead: Rent's next period (10-01) is not yet current on 09-09 (its period opens 09-24), so still one item.
    expect(upcomingRecurring(db, { today: "2026-09-25", days: 7 }).map((i) => [i.name, i.dueOn])).toEqual([["Rent", "2026-10-01"]]);
  });
});
