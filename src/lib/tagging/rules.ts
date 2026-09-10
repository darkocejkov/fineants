import type { RuleRow } from "../db/schema";

export type TxLike = { id: string; accountId: string; amountCents: number; payee: string | null; description: string };
export type RuleLike = Pick<RuleRow, "id" | "field" | "match" | "pattern" | "accountId" | "minAmountCents" | "maxAmountCents" | "categoryId" | "markTransfer">;
export type CompiledRule = RuleLike & { test(t: TxLike): boolean };

function textOf(t: TxLike, field: RuleLike["field"]): string[] {
  if (field === "payee") return t.payee ? [t.payee] : [];
  if (field === "description") return [t.description];
  return t.payee ? [t.payee, t.description] : [t.description];
}

/** Rules in the given order, minus any whose regex does not compile (reported, not thrown). */
export function compileRules(rules: RuleLike[]): { compiled: CompiledRule[]; invalid: { id: number; error: string }[] } {
  const compiled: CompiledRule[] = [];
  const invalid: { id: number; error: string }[] = [];
  for (const r of rules) {
    let matcher: (s: string) => boolean;
    if (r.match === "regex") {
      try {
        const re = new RegExp(r.pattern, "i");
        matcher = (s) => re.test(s);
      } catch (e) {
        invalid.push({ id: r.id, error: e instanceof Error ? e.message : String(e) });
        continue;
      }
    } else {
      const needle = r.pattern.toLowerCase();
      matcher = (s) => s.toLowerCase().includes(needle);
    }
    compiled.push({
      ...r,
      test(t) {
        if (r.accountId && t.accountId !== r.accountId) return false;
        if (r.minAmountCents !== null && t.amountCents < r.minAmountCents) return false;
        if (r.maxAmountCents !== null && t.amountCents > r.maxAmountCents) return false;
        return textOf(t, r.field).some(matcher);
      },
    });
  }
  return { compiled, invalid };
}

/** First matching rule that sets a category, and first that marks transfers; independently. */
export function firstMatches(compiled: CompiledRule[], t: TxLike): { category: CompiledRule | null; transfer: CompiledRule | null } {
  let category: CompiledRule | null = null;
  let transfer: CompiledRule | null = null;
  for (const r of compiled) {
    if (category && transfer) break;
    if ((!category && r.categoryId !== null) || (!transfer && r.markTransfer)) {
      if (!r.test(t)) continue;
      if (!category && r.categoryId !== null) category = r;
      if (!transfer && r.markTransfer) transfer = r;
    }
  }
  return { category, transfer };
}
