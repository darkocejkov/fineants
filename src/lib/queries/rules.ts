import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { rules, RULE_FIELDS, RULE_MATCHES, type RuleField, type RuleMatch, type RuleRow } from "../db/schema";

export type RuleInput = {
  name?: string;
  field: RuleField;
  match: RuleMatch;
  pattern: string;
  accountId?: string | null;
  minAmountCents?: number | null;
  maxAmountCents?: number | null;
  categoryId?: number | null;
  markTransfer?: boolean;
  active?: boolean;
};

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

const now = () => new Date().toISOString();

/**
 * Returns a message for the first problem, or null when the input is usable.
 * `forPreview` skips the "must set something" check: a preview only needs a matchable pattern.
 */
export function validateRuleInput(input: RuleInput, opts: { forPreview?: boolean } = {}): string | null {
  if (!(RULE_FIELDS as readonly string[]).includes(input.field)) return "Choose which field the rule looks at.";
  if (!(RULE_MATCHES as readonly string[]).includes(input.match)) return "Choose how the pattern matches.";
  const pattern = input.pattern.trim();
  if (!pattern) return "A rule needs a pattern to look for.";
  if (input.match === "regex") {
    try {
      new RegExp(pattern, "i");
    } catch (e) {
      return `That is not a valid regular expression: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (!opts.forPreview && (input.categoryId ?? null) === null && !input.markTransfer) return "A rule must set a category or mark transfers, or both.";
  const min = input.minAmountCents ?? null;
  const max = input.maxAmountCents ?? null;
  if (min !== null && !Number.isInteger(min)) return "The minimum amount must be a whole number of cents.";
  if (max !== null && !Number.isInteger(max)) return "The maximum amount must be a whole number of cents.";
  if (min !== null && max !== null && min > max) return "The minimum amount is larger than the maximum.";
  return null;
}

export function listRules(db: Db, opts: { includeInactive?: boolean } = {}): RuleRow[] {
  const q = db.select().from(rules);
  return (opts.includeInactive ? q : q.where(eq(rules.active, true))).orderBy(asc(rules.priority), asc(rules.id)).all();
}

export function getRule(db: Db, id: number): RuleRow | undefined {
  return db.select().from(rules).where(eq(rules.id, id)).get();
}

function toRow(input: RuleInput, nowIso: string) {
  const pattern = input.pattern.trim();
  return {
    name: (input.name ?? "").trim() || pattern,
    field: input.field,
    match: input.match,
    pattern,
    accountId: input.accountId ?? null,
    minAmountCents: input.minAmountCents ?? null,
    maxAmountCents: input.maxAmountCents ?? null,
    categoryId: input.categoryId ?? null,
    markTransfer: input.markTransfer ?? false,
    active: input.active ?? true,
    updatedAt: nowIso,
  };
}

export function createRule(db: Db, input: RuleInput, nowIso = now()): RuleRow {
  const problem = validateRuleInput(input);
  if (problem) throw new RuleError(problem);
  const max = db.select({ m: sql<number>`coalesce(max(${rules.priority}), -1)`.mapWith(Number) }).from(rules).get()!.m;
  return db.insert(rules).values({ ...toRow(input, nowIso), priority: max + 1, createdAt: nowIso }).returning().get();
}

export function updateRule(db: Db, id: number, input: RuleInput, nowIso = now()): void {
  const problem = validateRuleInput(input);
  if (problem) throw new RuleError(problem);
  db.update(rules).set(toRow(input, nowIso)).where(eq(rules.id, id)).run();
}

export function deleteRule(db: Db, id: number): void {
  db.delete(rules).where(eq(rules.id, id)).run();
}

export function moveRule(db: Db, id: number, direction: "up" | "down"): void {
  const all = listRules(db, { includeInactive: true });
  const i = all.findIndex((r) => r.id === id);
  if (i < 0) return;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return;
  db.transaction((tx) => {
    all.forEach((r, k) => tx.update(rules).set({ priority: k }).where(eq(rules.id, r.id)).run());
    tx.update(rules).set({ priority: j }).where(eq(rules.id, all[i].id)).run();
    tx.update(rules).set({ priority: i }).where(eq(rules.id, all[j].id)).run();
  });
}
