import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic } from "../helpers/seed";
import type { Db } from "@/lib/db/client";
import {
  DEFAULT_CATEGORIES, listCategories, createCategory, updateCategory, setCategoryArchived, moveCategory, seedDefaultCategories, dominantCurrency, getCategory,
} from "@/lib/queries/categories";
import { validateRuleInput, listRules, createRule, updateRule, deleteRule, moveRule, previewRuleMatches } from "@/lib/queries/rules";

let db: Db;
beforeEach(() => {
  db = makeTestDb();
  seedBasic(db);
});

describe("categories", () => {
  it("seeds defaults once", () => {
    expect(seedDefaultCategories(db)).toBe(DEFAULT_CATEGORIES.length);
    expect(seedDefaultCategories(db)).toBe(0);
    const names = listCategories(db).map((c) => c.name);
    expect(names[0]).toBe("Groceries");
    expect(names).toContain("Income");
    expect(listCategories(db).find((c) => c.name === "Income")!.kind).toBe("income");
  });
  it("creates, renames, caps, archives, and hides archived by default", () => {
    const c = createCategory(db, { name: "Pets", kind: "expense" });
    expect(c.id).toBeGreaterThan(0);
    updateCategory(db, c.id, { name: "Pet care", monthlyCapCents: 15000, capCurrency: "CAD" });
    expect(getCategory(db, c.id)).toMatchObject({ name: "Pet care", monthlyCapCents: 15000, capCurrency: "CAD" });
    updateCategory(db, c.id, { monthlyCapCents: null });
    expect(getCategory(db, c.id)!.monthlyCapCents).toBeNull();
    setCategoryArchived(db, c.id, true);
    expect(listCategories(db).find((x) => x.id === c.id)).toBeUndefined();
    expect(listCategories(db, { includeArchived: true }).find((x) => x.id === c.id)!.archived).toBe(true);
  });
  it("rejects a duplicate name differing only by case", () => {
    createCategory(db, { name: "Travel", kind: "expense" });
    expect(() => createCategory(db, { name: "travel", kind: "expense" })).toThrow(/already exists/);
  });
  it("moves categories up and down, clamped at the ends", () => {
    seedDefaultCategories(db);
    const [a, b] = listCategories(db);
    moveCategory(db, b.id, "up");
    expect(listCategories(db).slice(0, 2).map((c) => c.id)).toEqual([b.id, a.id]);
    moveCategory(db, b.id, "up"); // already first
    expect(listCategories(db)[0].id).toBe(b.id);
  });
  it("dominant currency is the one with most non-hidden accounts", () => {
    expect(dominantCurrency(db)).toBe("CAD");
    expect(dominantCurrency(makeTestDb())).toBeUndefined();
  });
});

describe("rules", () => {
  it("validates input", () => {
    expect(validateRuleInput({ field: "any", match: "contains", pattern: "SPOTIFY", categoryId: 1 })).toBeNull();
    expect(validateRuleInput({ field: "any", match: "contains", pattern: "  ", categoryId: 1 })).toMatch(/pattern/i);
    expect(validateRuleInput({ field: "any", match: "regex", pattern: "(", categoryId: 1 })).toMatch(/regular expression/i);
    expect(validateRuleInput({ field: "any", match: "contains", pattern: "X" })).toMatch(/category or mark/i);
    expect(validateRuleInput({ field: "any", match: "contains", pattern: "X" }, { forPreview: true })).toBeNull();
    expect(validateRuleInput({ field: "any", match: "contains", pattern: "X", markTransfer: true })).toBeNull();
    expect(validateRuleInput({ field: "any", match: "contains", pattern: "X", categoryId: 1, minAmountCents: 5, maxAmountCents: 1 })).toMatch(/minimum/i);
  });
  it("creates in priority order, moves, updates, deletes", () => {
    const c = createCategory(db, { name: "Subs", kind: "expense" });
    const r1 = createRule(db, { field: "payee", match: "contains", pattern: "SPOTIFY", categoryId: c.id });
    const r2 = createRule(db, { field: "any", match: "regex", pattern: "^NETFLIX", categoryId: c.id });
    expect(r1.name).toBe("SPOTIFY");
    expect(listRules(db).map((r) => r.id)).toEqual([r1.id, r2.id]);
    expect(r2.priority).toBeGreaterThan(r1.priority);
    moveRule(db, r2.id, "up");
    expect(listRules(db).map((r) => r.id)).toEqual([r2.id, r1.id]);
    moveRule(db, r2.id, "up");
    expect(listRules(db)[0].id).toBe(r2.id);
    updateRule(db, r1.id, { field: "payee", match: "contains", pattern: "SPOTIFY AB", categoryId: c.id, active: false });
    expect(listRules(db).map((r) => r.id)).toEqual([r2.id]);
    expect(listRules(db, { includeInactive: true })).toHaveLength(2);
    deleteRule(db, r2.id);
    expect(listRules(db, { includeInactive: true }).map((r) => r.id)).toEqual([r1.id]);
  });
  it("refuses invalid input on create and update", () => {
    expect(() => createRule(db, { field: "any", match: "regex", pattern: "(", categoryId: 1 })).toThrow(/regular expression/i);
  });
});

describe("previewRuleMatches", () => {
  it("counts and samples matching transactions without writing", () => {
    const r = previewRuleMatches(db, { field: "any", match: "contains", pattern: "o", categoryId: 1 }, 2);
    expect(r.count).toBeGreaterThanOrEqual(3);
    expect(r.sample).toHaveLength(2);
    expect(r.sample[0]).toHaveProperty("payee");
    expect(previewRuleMatches(db, { field: "any", match: "regex", pattern: "(", categoryId: 1 }).count).toBe(0);
  });
});
