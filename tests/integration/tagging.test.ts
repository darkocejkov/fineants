import { describe, it, expect, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { seedBasic, seedTransferPair, T0 } from "../helpers/seed";
import { seedRecurring, seedRecurringTransactions } from "../helpers/seed2b";
import type { Db } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";
import { createCategory } from "@/lib/queries/categories";
import { createRule, deleteRule, updateRule } from "@/lib/queries/rules";
import { deleteRecurringCost, updateRecurringCost } from "@/lib/queries/recurring";
import { applyTagging, applyRulesToOne, getLastTagging } from "@/lib/tagging/apply";
import { getMeta, setCategory, clearCategoryOverride, setTransfer, setRecurring } from "@/lib/queries/meta";

const day = (n: number) => Math.floor(T0 / 1000) - n * 86400;
const iso = (n: number) => new Date(T0 - n * 86400 * 1000).toISOString();

let db: Db;
let groceries: number;
let dining: number;
beforeEach(() => {
  db = makeTestDb();
  seedBasic(db);
  seedTransferPair(db);
  groceries = createCategory(db, { name: "Groceries", kind: "expense" }).id;
  dining = createCategory(db, { name: "Dining", kind: "expense" }).id;
});

describe("applyTagging rules", () => {
  it("categorises by the first matching rule and reports counts", () => {
    createRule(db, { field: "any", match: "contains", pattern: "grocery", categoryId: groceries });
    createRule(db, { field: "payee", match: "contains", pattern: "coffee", categoryId: dining });
    const r = applyTagging(db);
    expect(r.categorised).toBe(2);
    expect(getMeta(db, "t1")).toMatchObject({ categoryId: groceries, categorySource: "rule" });
    expect(getMeta(db, "t2")).toMatchObject({ categoryId: dining, categorySource: "rule" });
    expect(getMeta(db, "t3")).toBeUndefined();
    expect(getLastTagging(db)?.categorised).toBe(2);
  });
  it("is idempotent", () => {
    createRule(db, { field: "any", match: "contains", pattern: "grocery", categoryId: groceries });
    applyTagging(db);
    const r = applyTagging(db);
    expect(r).toMatchObject({ categorised: 0, categoryCleared: 0, transfersPaired: 0, transfersCleared: 0 });
  });
  it("manual category survives the pass and a rule change; clearing the override re-applies rules", () => {
    createRule(db, { field: "any", match: "contains", pattern: "grocery", categoryId: groceries });
    applyTagging(db);
    setCategory(db, "t1", dining);
    expect(applyTagging(db).categorised).toBe(0);
    expect(getMeta(db, "t1")).toMatchObject({ categoryId: dining, categorySource: "manual", ruleId: null });
    clearCategoryOverride(db, "t1");
    expect(getMeta(db, "t1")).toMatchObject({ categoryId: groceries, categorySource: "rule" });
  });
  it("manual 'no category' pins uncategorised", () => {
    createRule(db, { field: "any", match: "contains", pattern: "grocery", categoryId: groceries });
    setCategory(db, "t1", null);
    applyTagging(db);
    expect(getMeta(db, "t1")).toMatchObject({ categoryId: null, categorySource: "manual" });
  });
  it("editing a rule re-tags history on the next pass; deleting it clears what it set", () => {
    const rule = createRule(db, { field: "any", match: "contains", pattern: "grocery", categoryId: groceries });
    applyTagging(db);
    // The query layer never runs the pass itself; the server action does. So call it explicitly.
    updateRule(db, rule.id, { field: "any", match: "contains", pattern: "grocery", categoryId: dining });
    applyTagging(db);
    expect(getMeta(db, "t1")).toMatchObject({ categoryId: dining, ruleId: rule.id });
    deleteRule(db, rule.id);
    const r = applyTagging(db);
    expect(r.categoryCleared).toBe(1);
    expect(getMeta(db, "t1")).toBeUndefined();
  });
  it("skips an invalid stored regex and reports it", () => {
    createRule(db, { field: "any", match: "contains", pattern: "grocery", categoryId: groceries });
    // Bypass validation to simulate a rule that stopped compiling.
    db.run(sql`update rules set match = 'regex', pattern = '(' where pattern = 'grocery'`);
    const r = applyTagging(db);
    expect(r.invalidRules).toHaveLength(1);
    expect(getMeta(db, "t1")).toBeUndefined();
  });
  it("applyRulesToOne touches only that transaction", () => {
    createRule(db, { field: "any", match: "contains", pattern: "grocery", categoryId: groceries });
    createRule(db, { field: "payee", match: "contains", pattern: "coffee", categoryId: dining });
    applyRulesToOne(db, "t1");
    expect(getMeta(db, "t1")?.categoryId).toBe(groceries);
    expect(getMeta(db, "t2")).toBeUndefined();
  });
});

describe("applyTagging transfers", () => {
  it("pairs the seeded transfer and marks both rows", () => {
    const r = applyTagging(db);
    expect(r.transfersPaired).toBe(1);
    expect(getMeta(db, "xfer-out")).toMatchObject({ isTransfer: true, transferSource: "auto", counterpartTransactionId: "xfer-in" });
    expect(getMeta(db, "xfer-in")).toMatchObject({ isTransfer: true, transferSource: "auto", counterpartTransactionId: "xfer-out" });
  });
  it("a manual 'not a transfer' sticks and frees the partner", () => {
    applyTagging(db);
    setTransfer(db, "xfer-out", false);
    const r = applyTagging(db);
    expect(getMeta(db, "xfer-out")).toMatchObject({ isTransfer: false, transferSource: "manual", counterpartTransactionId: null });
    expect(getMeta(db, "xfer-in")?.isTransfer ?? false).toBe(false);
    expect(r.transfersPaired).toBe(0);
  });
  it("a manual 'is a transfer' on an unpaired row is kept", () => {
    setTransfer(db, "t4", true);
    applyTagging(db);
    expect(getMeta(db, "t4")).toMatchObject({ isTransfer: true, transferSource: "manual" });
  });
  it("pinning an already-auto-paired row as a transfer keeps the pair intact", () => {
    applyTagging(db);
    setTransfer(db, "xfer-out", true);
    const r = applyTagging(db);
    expect(getMeta(db, "xfer-out")).toMatchObject({ isTransfer: true, transferSource: "manual", counterpartTransactionId: "xfer-in" });
    expect(getMeta(db, "xfer-in")).toMatchObject({ isTransfer: true, counterpartTransactionId: "xfer-out" });
    expect(r.transfersCleared).toBe(0);
  });
  it("un-marking a confirmed transfer frees the auto partner it still points at", () => {
    applyTagging(db);
    setTransfer(db, "xfer-out", true); // confirm the pair: xfer-out is now manual, xfer-in still auto
    setTransfer(db, "xfer-out", false); // and change your mind
    expect(getMeta(db, "xfer-out")).toMatchObject({ isTransfer: false, transferSource: "manual", counterpartTransactionId: null });
    expect(getMeta(db, "xfer-in")?.isTransfer ?? false).toBe(false);
    expect(getMeta(db, "xfer-in")?.counterpartTransactionId ?? null).toBeNull();
    // xfer-out is pinned as "not a transfer", so the pass has nothing to pair xfer-in with.
    const r = applyTagging(db);
    expect(r.transfersPaired).toBe(0);
    expect(getMeta(db, "xfer-in")?.isTransfer ?? false).toBe(false);
    expect(getMeta(db, "xfer-in")?.counterpartTransactionId ?? null).toBeNull();
  });
  it("clears both sides of a pair once one of the accounts is hidden", () => {
    applyTagging(db);
    db.update(accounts).set({ hidden: true }).where(eq(accounts.id, "SAV")).run();
    const r = applyTagging(db);
    // transfersCleared counts rows, not pairs: the pass drops the auto pairing on both sides and
    // the hidden row is no longer a re-pairing candidate, so both stop being transfers.
    expect(r.transfersCleared).toBe(2);
    expect(getMeta(db, "xfer-out")?.isTransfer ?? false).toBe(false);
    expect(getMeta(db, "xfer-in")?.isTransfer ?? false).toBe(false);
  });
  it("a confirmed pair's auto side is not stolen by a same-amount collision", () => {
    applyTagging(db);
    setTransfer(db, "xfer-out", true);
    // Another outflow, same currency/amount, nearest to xfer-in: would win the greedy match if
    // xfer-in were still a re-pairing candidate.
    db.insert(transactions).values({
      id: "decoy-out",
      accountId: "VISA",
      posted: day(5),
      transactedAt: null,
      amountCents: -75000,
      description: "UNRELATED TRANSFER",
      payee: null,
      memo: null,
      pending: false,
      raw: "{}",
      firstSeenAt: iso(5),
      lastSeenAt: iso(0),
      localDate: iso(5).slice(0, 10),
    }).run();
    applyTagging(db);
    expect(getMeta(db, "xfer-in")).toMatchObject({ counterpartTransactionId: "xfer-out" });
    expect(getMeta(db, "decoy-out")?.isTransfer ?? false).toBe(false);
  });
  it("a rule marking transfers takes the row out of auto pairing", () => {
    createRule(db, { field: "any", match: "contains", pattern: "TRANSFER TO", markTransfer: true });
    const r = applyTagging(db);
    expect(getMeta(db, "xfer-out")).toMatchObject({ isTransfer: true, transferSource: "rule" });
    expect(r.transfersPaired).toBe(0);
  });
  it("drops the meta row entirely when nothing is left on it", () => {
    createRule(db, { field: "any", match: "contains", pattern: "grocery", categoryId: groceries });
    applyTagging(db);
    deleteRule(db, getMeta(db, "t1")!.ruleId!);
    applyTagging(db);
    expect(getMeta(db, "t1")).toBeUndefined();
  });
});

describe("applyTagging recurring (6.3)", () => {
  it("links matching outflows, one per period, and reports the count", () => {
    const { spotifyId } = seedRecurring(db);
    seedRecurringTransactions(db);
    const r = applyTagging(db);
    expect(r.recurringMatched).toBe(2);
    expect(getMeta(db, "sp-1")).toMatchObject({ recurringCostId: spotifyId, recurringSource: "auto" });
    expect(getMeta(db, "sp-2")).toMatchObject({ recurringCostId: spotifyId, recurringSource: "auto" });
    expect(getMeta(db, "sp-near")?.recurringCostId ?? null).toBeNull();
    expect(applyTagging(db).recurringMatched).toBe(0); // idempotent
  });
  it("applies the cost's category when the row has none, with source recurring, and a rule still wins", () => {
    const { spotifyId } = seedRecurring(db);
    seedRecurringTransactions(db);
    updateRecurringCost(db, spotifyId, { name: "Spotify", currency: "CAD", amountCents: 1299, cadence: "monthly", anchorOn: "2026-09-05", matchPattern: "spotify", categoryId: dining });
    applyTagging(db);
    expect(getMeta(db, "sp-2")).toMatchObject({ categoryId: dining, categorySource: "recurring" });
    createRule(db, { field: "any", match: "contains", pattern: "spotify", categoryId: groceries });
    applyTagging(db);
    expect(getMeta(db, "sp-2")).toMatchObject({ categoryId: groceries, categorySource: "rule", recurringCostId: spotifyId });
  });
  it("a manual link survives and occupies its period", () => {
    const { spotifyId } = seedRecurring(db);
    seedRecurringTransactions(db);
    setRecurring(db, "sp-near", spotifyId);
    applyTagging(db);
    expect(getMeta(db, "sp-near")).toMatchObject({ recurringCostId: spotifyId, recurringSource: "manual" });
    expect(getMeta(db, "sp-2")?.recurringCostId ?? null).toBeNull(); // September period taken by the manual link
    expect(getMeta(db, "sp-1")).toMatchObject({ recurringCostId: spotifyId, recurringSource: "auto" });
  });
  it("deleting a cost clears its auto links and recurring-sourced categories on the next pass", () => {
    const { spotifyId } = seedRecurring(db);
    seedRecurringTransactions(db);
    updateRecurringCost(db, spotifyId, { name: "Spotify", currency: "CAD", amountCents: 1299, cadence: "monthly", anchorOn: "2026-09-05", matchPattern: "spotify", categoryId: dining });
    applyTagging(db);
    deleteRecurringCost(db, spotifyId); // FK on delete set null clears recurring_cost_id
    applyTagging(db);
    expect(getMeta(db, "sp-2")).toBeUndefined();
  });
});
