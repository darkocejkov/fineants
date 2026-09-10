import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { loadConfig } from "../config";

export type Db = BetterSQLite3Database<typeof schema>;

const DEFAULT_MIGRATIONS = path.join(process.cwd(), "src", "lib", "db", "migrations");

export function createDb(dbPath: string, opts: { migrationsFolder?: string } = {}): Db {
  const isMemory = dbPath === ":memory:";
  if (!isMemory) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  if (!isMemory) sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: opts.migrationsFolder ?? process.env.MIGRATIONS_DIR ?? DEFAULT_MIGRATIONS });
  return db;
}

const g = globalThis as unknown as { __fineantsDb?: Db };

export function getDb(): Db {
  if (!g.__fineantsDb) {
    g.__fineantsDb = createDb(loadConfig().databasePath);
  }
  return g.__fineantsDb;
}
