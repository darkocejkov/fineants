import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseAccountSet, SimpleFinParseError } from "@/lib/simplefin/schema";

const load = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "simplefin", name), "utf8"));

describe("parseAccountSet old shape", () => {
  const set = parseAccountSet(load("old-shape.json"));
  it("derives one connection from org", () => {
    expect(set.connections).toHaveLength(1);
    expect(set.connections[0]).toMatchObject({ id: "org-1", name: "Example Bank", domain: "examplebank.com" });
  });
  it("normalises accounts with cents and connection id", () => {
    const acc = set.accounts.find((a) => a.id === "ACC-1")!;
    expect(acc).toMatchObject({ connectionId: "org-1", currency: "CAD", balanceCents: 152344, availableBalanceCents: 150000, balanceDate: 1757400000 });
    expect(set.accounts.find((a) => a.id === "ACC-2")!.balanceCents).toBe(-82015);
    expect(set.accounts.find((a) => a.id === "ACC-2")!.availableBalanceCents).toBeUndefined();
  });
  it("normalises transactions incl. payee, memo, pending", () => {
    const [t1, t2] = set.accounts[0].transactions;
    expect(t1).toMatchObject({ id: "TX-1", posted: 1757300000, amountCents: -4510, description: "GROCERY MART", payee: "Grocery Mart", memo: "POS", pending: false });
    expect(t2).toMatchObject({ id: "TX-2", posted: 0, pending: true, transactedAt: 1757390000 });
  });
  it("maps legacy string errors to gen.legacy", () => {
    expect(set.errlist).toEqual([{ code: "gen.legacy", msg: "Connection to Example Bank may need attention" }]);
  });
  it("preserves unknown fields in raw", () => {
    expect((set.accounts[0].raw as { extra: unknown }).extra).toEqual({ "account-open-date": 1600000000 });
    expect((set.accounts[0].transactions[0].raw as { transaction_id: string }).transaction_id).toBe("bank-tx-1");
  });
});

describe("parseAccountSet new shape", () => {
  const set = parseAccountSet(load("new-shape.json"));
  it("uses connections array", () => {
    expect(set.connections[0]).toMatchObject({ id: "conn-9", name: "New Bank", url: "https://newbank.example", sfinUrl: "https://bridge.example/simplefin" });
    expect(set.accounts[0].connectionId).toBe("conn-9");
  });
  it("keeps structured errlist", () => {
    expect(set.errlist).toEqual([{ code: "con.auth", msg: "Please re-authenticate", connId: "conn-9" }]);
  });
  it("parses amounts with one decimal", () => {
    expect(set.accounts[0].transactions[0].amountCents).toBe(25050);
    expect(set.accounts[0].balanceCents).toBe(1000000);
  });
});

describe("parseAccountSet edge cases", () => {
  it("handles errlist-only responses", () => {
    const set = parseAccountSet(load("errlist-only.json"));
    expect(set.accounts).toEqual([]);
    expect(set.errlist[0].code).toBe("gen.maint");
  });
  it("treats posted 0 as pending even without the flag", () => {
    const set = parseAccountSet({ accounts: [{ id: "A", name: "n", currency: "CAD", balance: "0", "balance-date": 1, org: { name: "o" }, transactions: [{ id: "T", posted: 0, amount: "1", description: "d" }] }] });
    expect(set.accounts[0].transactions[0].pending).toBe(true);
  });
  it("synthesises a connection id for an org without id", () => {
    const set = parseAccountSet({ accounts: [{ id: "A", name: "n", currency: "CAD", balance: "0", "balance-date": 1, org: { name: "Bank", domain: "bank.example" }, transactions: [] }] });
    expect(set.connections[0].id).toBe("bank.example");
    expect(set.accounts[0].connectionId).toBe("bank.example");
  });
  it("throws SimpleFinParseError on nonsense", () => {
    expect(() => parseAccountSet({ accounts: "nope" })).toThrow(SimpleFinParseError);
    expect(() => parseAccountSet(null)).toThrow(SimpleFinParseError);
  });
});
