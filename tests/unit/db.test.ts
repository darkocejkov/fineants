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
