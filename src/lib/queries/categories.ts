import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, categories, type CategoryKind, type CategoryRow } from "../db/schema";

export const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind }[] = [
  { name: "Groceries", kind: "expense" },
  { name: "Dining", kind: "expense" },
  { name: "Transport", kind: "expense" },
  { name: "Housing", kind: "expense" },
  { name: "Utilities", kind: "expense" },
  { name: "Subscriptions", kind: "expense" },
  { name: "Shopping", kind: "expense" },
  { name: "Health", kind: "expense" },
  { name: "Entertainment", kind: "expense" },
  { name: "Debt payments", kind: "expense" },
  { name: "Other", kind: "expense" },
  { name: "Income", kind: "income" },
];

export class CategoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CategoryError";
  }
}

const now = () => new Date().toISOString();

export function listCategories(db: Db, opts: { includeArchived?: boolean } = {}): CategoryRow[] {
  const q = db.select().from(categories);
  return (opts.includeArchived ? q : q.where(eq(categories.archived, false))).orderBy(asc(categories.sortOrder), asc(categories.id)).all();
}

export function getCategory(db: Db, id: number): CategoryRow | undefined {
  return db.select().from(categories).where(eq(categories.id, id)).get();
}

function assertNameFree(db: Db, name: string, exceptId?: number): void {
  const clash = db.select({ id: categories.id }).from(categories).where(sql`lower(${categories.name}) = lower(${name})`).get();
  if (clash && clash.id !== exceptId) throw new CategoryError(`A category named "${name}" already exists.`);
}

export function createCategory(db: Db, input: { name: string; kind: CategoryKind }, nowIso = now()): CategoryRow {
  const name = input.name.trim();
  if (!name) throw new CategoryError("A category needs a name.");
  assertNameFree(db, name);
  const max = db.select({ m: sql<number>`coalesce(max(${categories.sortOrder}), -1)`.mapWith(Number) }).from(categories).get()!.m;
  return db.insert(categories).values({ name, kind: input.kind, sortOrder: max + 1, createdAt: nowIso, updatedAt: nowIso }).returning().get();
}

export function updateCategory(
  db: Db,
  id: number,
  patch: { name?: string; kind?: CategoryKind; monthlyCapCents?: number | null; capCurrency?: string | null },
  nowIso = now(),
): void {
  const set: Partial<typeof categories.$inferInsert> = { updatedAt: nowIso };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new CategoryError("A category needs a name.");
    assertNameFree(db, name, id);
    set.name = name;
  }
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.monthlyCapCents !== undefined) {
    if (patch.monthlyCapCents !== null && (!Number.isInteger(patch.monthlyCapCents) || patch.monthlyCapCents <= 0)) {
      throw new CategoryError("A monthly cap must be a positive amount.");
    }
    set.monthlyCapCents = patch.monthlyCapCents;
    if (patch.monthlyCapCents === null) set.capCurrency = null;
  }
  if (patch.capCurrency !== undefined) set.capCurrency = patch.capCurrency;
  db.update(categories).set(set).where(eq(categories.id, id)).run();
}

export function setCategoryArchived(db: Db, id: number, archived: boolean, nowIso = now()): void {
  db.update(categories).set({ archived, updatedAt: nowIso }).where(eq(categories.id, id)).run();
}

export function moveCategory(db: Db, id: number, direction: "up" | "down"): void {
  const all = listCategories(db, { includeArchived: true });
  const i = all.findIndex((c) => c.id === id);
  if (i < 0) return;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return;
  db.transaction((tx) => {
    // Normalise to 0..n-1 first so swaps are always distinct integers.
    all.forEach((c, k) => tx.update(categories).set({ sortOrder: k }).where(eq(categories.id, c.id)).run());
    tx.update(categories).set({ sortOrder: j }).where(eq(categories.id, all[i].id)).run();
    tx.update(categories).set({ sortOrder: i }).where(eq(categories.id, all[j].id)).run();
  });
}

export function seedDefaultCategories(db: Db, nowIso = now()): number {
  const existing = db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(categories).get()!.n;
  if (existing > 0) return 0;
  db.insert(categories).values(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i, createdAt: nowIso, updatedAt: nowIso }))).run();
  return DEFAULT_CATEGORIES.length;
}

/** The currency with the most non-hidden accounts; ties alphabetical. */
export function dominantCurrency(db: Db): string | undefined {
  return db
    .select({ currency: accounts.currency, n: sql<number>`count(*)`.mapWith(Number) })
    .from(accounts)
    .where(eq(accounts.hidden, false))
    .groupBy(accounts.currency)
    .orderBy(sql`count(*) desc`, asc(accounts.currency))
    .get()?.currency;
}
