import { describe, it, expect } from "vitest";
import { pairTransfers, type TransferCandidate } from "@/lib/tagging/transfers";

const DAY = 86400;
const T = 1_757_400_000;
const c = (id: string, accountId: string, amountCents: number, dayOffset: number, over: Partial<TransferCandidate> = {}): TransferCandidate => ({
  id, accountId, currency: "CAD", amountCents, dateSec: T + dayOffset * DAY, pending: false, ...over,
});

describe("pairTransfers", () => {
  it("pairs equal and opposite amounts across accounts within the window", () => {
    expect(pairTransfers([c("out", "CHQ", -50000, 0), c("in", "SAV", 50000, 1)])).toEqual([{ outflowId: "out", inflowId: "in" }]);
  });
  it("ignores same-account, different currency, pending, and far-apart rows", () => {
    expect(pairTransfers([c("a", "CHQ", -50000, 0), c("b", "CHQ", 50000, 0)])).toEqual([]);
    expect(pairTransfers([c("a", "CHQ", -50000, 0), c("b", "SAV", 50000, 0, { currency: "USD" })])).toEqual([]);
    expect(pairTransfers([c("a", "CHQ", -50000, 0), c("b", "SAV", 50000, 0, { pending: true })])).toEqual([]);
    expect(pairTransfers([c("a", "CHQ", -50000, 0), c("b", "SAV", 50000, 4)])).toEqual([]);
    expect(pairTransfers([c("a", "CHQ", -50000, 0), c("b", "SAV", 50000, 3)])).toHaveLength(1);
    expect(pairTransfers([c("a", "CHQ", -50000, 0), c("b", "SAV", 50000, -3)])).toHaveLength(1);
  });
  it("prefers the nearest date, then the smaller id, and gives each row one partner", () => {
    const pairs = pairTransfers([
      c("out1", "CHQ", -10000, 0),
      c("in-far", "SAV", 10000, 2),
      c("in-near", "SAV", 10000, 0),
      c("out2", "VISA", -10000, 2),
    ]);
    expect(pairs).toEqual([
      { outflowId: "out1", inflowId: "in-near" },
      { outflowId: "out2", inflowId: "in-far" },
    ]);
  });
  it("breaks equal-distance ties by id", () => {
    const pairs = pairTransfers([c("out", "CHQ", -100, 0), c("b-in", "SAV", 100, 1), c("a-in", "TFSA", 100, -1)]);
    expect(pairs).toEqual([{ outflowId: "out", inflowId: "a-in" }]);
  });
  it("never pairs two outflows or two inflows", () => {
    expect(pairTransfers([c("a", "CHQ", -100, 0), c("b", "SAV", -100, 0)])).toEqual([]);
  });
});
