import { describe, it, expect } from "vitest";
import { matchRecurring, type RecurringCandidate, type RecurringCostLike } from "@/lib/tagging/recurringMatch";

const spotify: RecurringCostLike = { id: 1, currency: "CAD", amountCents: 1299, cadence: "monthly", intervalDays: null, anchorOn: "2026-09-05", accountId: null, matchPattern: "spotify", matchToleranceBps: 1000, categoryId: 7 };
const c = (id: string, localDate: string, amountCents: number, over: Partial<RecurringCandidate> = {}): RecurringCandidate => ({
  id, accountId: "CHQ", currency: "CAD", amountCents, payee: "Spotify AB", description: "SPOTIFY P1234", localDate, isTransfer: false, hidden: false, pending: false, manualCostId: null, ...over,
});

describe("matchRecurring", () => {
  it("links one outflow per period, nearest to the due date", () => {
    const links = matchRecurring(spotify, [c("a", "2026-08-05", -1299), c("b", "2026-09-05", -1299), c("b2", "2026-09-06", -1250)]);
    expect(links).toEqual([{ transactionId: "a", dueOn: "2026-08-05" }, { transactionId: "b", dueOn: "2026-09-05" }]);
  });
  it("respects pattern, currency, account, tolerance, sign, transfer, hidden, pending", () => {
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { payee: "Netflix", description: "NETFLIX" })])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { currency: "USD" })])).toEqual([]);
    expect(matchRecurring({ ...spotify, accountId: "VISA" }, [c("x", "2026-09-05", -1299)])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1500)])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", 1299)])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { isTransfer: true })])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { hidden: true })])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { pending: true })])).toEqual([]);
  });
  it("rounds the tolerance bounds outwards, as the pattern preview does", () => {
    // 1299 ± 10% is 1169.1 … 1428.9; the preview widens to 1169 … 1429, so the pass must too.
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1169)])).toHaveLength(1);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1168)])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1429)])).toHaveLength(1);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1430)])).toEqual([]);
  });
  it("matches case-insensitively on payee or description", () => {
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { payee: null, description: "spotify premium" })])).toHaveLength(1);
  });
  it("skips a period already occupied by a manual link and never returns manual rows", () => {
    const links = matchRecurring(spotify, [c("m", "2026-09-04", -1299, { manualCostId: 1 }), c("b", "2026-09-05", -1299)]);
    expect(links).toEqual([]);
    // A manual link to a *different* cost excludes only that row.
    expect(matchRecurring(spotify, [c("m", "2026-09-04", -1299, { manualCostId: 2 }), c("b", "2026-09-05", -1299)])).toEqual([{ transactionId: "b", dueOn: "2026-09-05" }]);
  });
  it("returns nothing without a pattern", () => {
    expect(matchRecurring({ ...spotify, matchPattern: null }, [c("a", "2026-09-05", -1299)])).toEqual([]);
  });
});
