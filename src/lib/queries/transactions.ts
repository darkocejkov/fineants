import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, transactions, type TransactionRow } from "../db/schema";

export type TxFilter = { accountId?: string; q?: string; from?: string; to?: string; page?: number; pageSize?: number; includeHidden?: boolean };
export type TxRow = TransactionRow & { accountName: string; currency: string; effectiveDate: number };

export const effectiveDate = sql<number>`coalesce(nullif(${transactions.posted}, 0), ${transactions.transactedAt}, unixepoch(${transactions.firstSeenAt}))`;

export function dateToUnix(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(date: string): boolean {
  return DATE_RE.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`));
}

// Escape LIKE metacharacters (\, %, _) so user search text matches literally; backslash must
// be escaped first so the escaping we add for % and _ isn't itself re-escaped.
function escapeLikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function buildWhere(f: TxFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  if (!f.includeHidden) parts.push(eq(accounts.hidden, false));
  if (f.accountId) parts.push(eq(transactions.accountId, f.accountId));
  if (f.q?.trim()) {
    const pat = `%${escapeLikePattern(f.q.trim())}%`;
    parts.push(
      or(
        sql`${transactions.description} like ${pat} escape '\\'`,
        sql`${transactions.payee} like ${pat} escape '\\'`,
        sql`${transactions.memo} like ${pat} escape '\\'`,
      ),
    );
  }
  if (f.from && isValidDate(f.from)) parts.push(gte(effectiveDate, dateToUnix(f.from)));
  if (f.to && isValidDate(f.to)) parts.push(lt(effectiveDate, dateToUnix(f.to) + 86400));
  return and(...parts.filter(Boolean) as SQL[]);
}

export function listTransactions(db: Db, f: TxFilter = {}): { rows: TxRow[]; total: number; page: number; pageSize: number } {
  const page = typeof f.page === "number" && Number.isFinite(f.page) ? Math.max(1, Math.trunc(f.page)) : 1;
  const pageSize =
    typeof f.pageSize === "number" && Number.isFinite(f.pageSize) ? Math.min(500, Math.max(1, Math.trunc(f.pageSize))) : 50;
  const where = buildWhere(f);
  const total = db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(where)
    .get()!.n;
  const rows = db
    .select({ t: transactions, accountName: sql<string>`coalesce(nullif(trim(${accounts.nickname}), ''), ${accounts.name})`, currency: accounts.currency, effectiveDate })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(where)
    .orderBy(desc(effectiveDate), desc(transactions.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()
    .map((r) => ({ ...r.t, accountName: r.accountName, currency: r.currency, effectiveDate: r.effectiveDate }));
  return { rows, total, page, pageSize };
}

export function recentTransactions(db: Db, limit: number): TxRow[] {
  return listTransactions(db, { page: 1, pageSize: limit }).rows;
}
