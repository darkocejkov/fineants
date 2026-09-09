import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, connections, type AccountRow, type AccountType } from "../db/schema";

export function listAccounts(db: Db, opts: { includeHidden?: boolean } = {}): AccountRow[] {
  const rows = db
    .select({ a: accounts })
    .from(accounts)
    .leftJoin(connections, eq(accounts.connectionId, connections.id))
    .where(opts.includeHidden ? undefined : eq(accounts.hidden, false))
    .orderBy(asc(connections.name), asc(accounts.name))
    .all();
  return rows.map((r) => r.a);
}

export function getAccount(db: Db, id: string): AccountRow | undefined {
  return db.select().from(accounts).where(eq(accounts.id, id)).get();
}

export function totalsByCurrency(db: Db): { currency: string; balanceCents: number }[] {
  return db
    .select({ currency: accounts.currency, balanceCents: sql<number>`sum(${accounts.balanceCents})`.mapWith(Number) })
    .from(accounts)
    .where(eq(accounts.hidden, false))
    .groupBy(accounts.currency)
    .orderBy(asc(accounts.currency))
    .all();
}

export function updateAccountSettings(db: Db, id: string, patch: { nickname?: string | null; type?: AccountType | null; hidden?: boolean }): void {
  const set: Partial<AccountRow> = {};
  if (patch.nickname !== undefined) set.nickname = patch.nickname?.trim() ? patch.nickname.trim() : null;
  if (patch.type !== undefined) set.type = patch.type ?? null;
  if (patch.hidden !== undefined) set.hidden = patch.hidden ?? false;
  if (Object.keys(set).length === 0) return;
  db.update(accounts).set(set).where(eq(accounts.id, id)).run();
}

export function displayName(a: Pick<AccountRow, "nickname" | "name">): string {
  return a.nickname?.trim() || a.name;
}
