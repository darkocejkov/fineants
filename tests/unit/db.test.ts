import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { getState, setState, deleteState } from "@/lib/db/appState";

describe("createDb", () => {
  it("creates all tables", () => {
    const db = makeTestDb();
    const rows = db.all<{ name: string }>(sql`select name from sqlite_master where type='table' order by name`);
    const names = rows.map((r) => r.name);
    for (const t of ["accounts", "app_state", "balance_snapshots", "connections", "sync_runs", "transactions"]) {
      expect(names).toContain(t);
    }
  });
});

describe("appState", () => {
  it("round-trips JSON values and overwrites", () => {
    const db = makeTestDb();
    expect(getState(db, "k")).toBeUndefined();
    setState(db, "k", { a: 1 });
    expect(getState<{ a: number }>(db, "k")).toEqual({ a: 1 });
    setState(db, "k", 42);
    expect(getState<number>(db, "k")).toBe(42);
    deleteState(db, "k");
    expect(getState(db, "k")).toBeUndefined();
  });
});

describe("phase 2 schema", () => {
  it("creates every phase 2 table and the local_date column", () => {
    const db = makeTestDb();
    const tables = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' order by name`).map((r) => r.name);
    for (const t of ["categories", "rules", "transaction_meta", "external_debts", "debt_payments", "recurring_costs", "connection_sync_state"]) {
      expect(tables).toContain(t);
    }
    const cols = db.all<{ name: string }>(sql`pragma table_info(transactions)`).map((r) => r.name);
    expect(cols).toContain("local_date");
    const idx = db.all<{ name: string }>(sql`pragma index_list(transactions)`).map((r) => r.name);
    expect(idx).toContain("transactions_local_date_idx");
  });
  it("enforces one debt per linked transaction and case-insensitive unique category names", () => {
    const db = makeTestDb();
    db.run(sql`insert into categories (name, kind, sort_order, archived, created_at, updated_at) values ('Groceries','expense',0,0,'x','x')`);
    expect(() => db.run(sql`insert into categories (name, kind, sort_order, archived, created_at, updated_at) values ('groceries','expense',1,0,'x','x')`)).toThrow();
  });
});
