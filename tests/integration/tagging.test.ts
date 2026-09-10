import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { seedBasic, seedTransferPair } from "../helpers/seed";
import type { Db } from "@/lib/db/client";
import { createCategory } from "@/lib/queries/categories";
import { createRule, deleteRule, updateRule } from "@/lib/queries/rules";
import { applyTagging, applyRulesToOne, getLastTagging } from "@/lib/tagging/apply";
import { getMeta, setCategory, clearCategoryOverride, setTransfer } from "@/lib/queries/meta";

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
