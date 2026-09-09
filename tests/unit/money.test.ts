import { describe, it, expect } from "vitest";
import { parseAmountToCents, formatCents, MoneyParseError } from "@/lib/money";

describe("parseAmountToCents", () => {
  it("parses positive and negative decimals", () => {
    expect(parseAmountToCents("12.34")).toBe(1234);
    expect(parseAmountToCents("-12.34")).toBe(-1234);
  });
  it("parses integers and single decimals", () => {
    expect(parseAmountToCents("1000")).toBe(100000);
    expect(parseAmountToCents("0.5")).toBe(50);
    expect(parseAmountToCents("-0.5")).toBe(-50);
  });
  it("normalises negative zero", () => {
    expect(Object.is(parseAmountToCents("-0.00"), 0)).toBe(true);
  });
  it("accepts numbers", () => {
    expect(parseAmountToCents(3.5)).toBe(350);
  });
  it("rejects more than two decimals", () => {
    expect(() => parseAmountToCents("1.234")).toThrow(MoneyParseError);
  });
  it("rejects garbage", () => {
    expect(() => parseAmountToCents("abc")).toThrow(MoneyParseError);
    expect(() => parseAmountToCents("")).toThrow(MoneyParseError);
  });
});

describe("formatCents", () => {
  it("formats ISO currencies", () => {
    expect(formatCents(-1234, "CAD", "en-CA")).toBe("-$12.34");
    expect(formatCents(100000, "USD", "en-US")).toBe("$1,000.00");
  });
  it("falls back for non-ISO currency strings", () => {
    expect(formatCents(1234, "https://example.org/coin")).toBe("12.34 https://example.org/coin");
    expect(formatCents(-5, "XXXX")).toBe("-0.05 XXXX");
  });
});
