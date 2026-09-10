import { describe, it, expect } from "vitest";
import { compileRules, firstMatches, type RuleLike, type TxLike } from "@/lib/tagging/rules";

const base: Omit<RuleLike, "id" | "pattern"> = { field: "any", match: "contains", accountId: null, minAmountCents: null, maxAmountCents: null, categoryId: 1, markTransfer: false };
const rule = (id: number, pattern: string, over: Partial<RuleLike> = {}): RuleLike => ({ ...base, id, pattern, ...over });
const tx = (over: Partial<TxLike> = {}): TxLike => ({ id: "t", accountId: "CHQ", amountCents: -1299, payee: "Spotify AB", description: "SPOTIFY P1234", ...over });

describe("compileRules", () => {
  it("contains is case-insensitive and honours the field", () => {
    const { compiled } = compileRules([rule(1, "spotify", { field: "payee" }), rule(2, "p1234", { field: "description" }), rule(3, "nothing")]);
    expect(compiled[0].test(tx())).toBe(true);
    expect(compiled[1].test(tx())).toBe(true);
    expect(compiled[2].test(tx())).toBe(false);
    expect(compiled[0].test(tx({ payee: null }))).toBe(false);
  });
  it("any looks at payee or description", () => {
    const { compiled } = compileRules([rule(1, "p1234")]);
    expect(compiled[0].test(tx({ payee: null }))).toBe(true);
  });
  it("regex compiles with the i flag and invalid regexes are reported, not thrown", () => {
    const { compiled, invalid } = compileRules([rule(1, "^spot", { match: "regex" }), rule(2, "(", { match: "regex" })]);
    expect(compiled).toHaveLength(1);
    expect(compiled[0].test(tx())).toBe(true);
    expect(invalid).toEqual([{ id: 2, error: expect.stringMatching(/./) }]);
  });
  it("applies account and signed amount bounds", () => {
    const { compiled } = compileRules([
      rule(1, "spotify", { accountId: "VISA" }),
      rule(2, "spotify", { minAmountCents: -2000, maxAmountCents: -1000 }),
      rule(3, "spotify", { minAmountCents: 0 }),
    ]);
    expect(compiled[0].test(tx())).toBe(false);
    expect(compiled[0].test(tx({ accountId: "VISA" }))).toBe(true);
    expect(compiled[1].test(tx())).toBe(true);
    expect(compiled[1].test(tx({ amountCents: -2500 }))).toBe(false);
    expect(compiled[2].test(tx())).toBe(false);
    expect(compiled[2].test(tx({ amountCents: 500 }))).toBe(true);
  });
});

describe("firstMatches", () => {
  it("picks the first rule per action independently", () => {
    const { compiled } = compileRules([
      rule(1, "spotify", { categoryId: null, markTransfer: true }),
      rule(2, "spotify", { categoryId: 7 }),
      rule(3, "spotify", { categoryId: 8 }),
    ]);
    const m = firstMatches(compiled, tx());
    expect(m.transfer?.id).toBe(1);
    expect(m.category?.id).toBe(2);
  });
  it("returns nulls when nothing matches", () => {
    const { compiled } = compileRules([rule(1, "zzz")]);
    expect(firstMatches(compiled, tx())).toEqual({ category: null, transfer: null });
  });
});
