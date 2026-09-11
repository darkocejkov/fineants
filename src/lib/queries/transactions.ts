import { and, desc, eq, gte, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, categories, debtPayments, externalDebts, transactionMeta, transactions, type TransactionRow } from "../db/schema";

export type TxFilter = {
  accountId?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  includeHidden?: boolean;
  categoryId?: number | "none";
  hideTransfers?: boolean;
};
export type TxRow = TransactionRow & {
  accountName: string;
  currency: string;
  effectiveDate: number;
  categoryId: number | null;
  categoryName: string | null;
  categorySource: "rule" | "recurring" | "manual" | null;
  isTransfer: boolean;
  transferSource: "auto" | "rule" | "manual" | null;
  debtId: number | null;
  debtName: string | null;
};

export const effectiveDate = sql<number>`coalesce(nullif(${transactions.posted}, 0), ${transactions.transactedAt}, unixepoch(${transactions.firstSeenAt}))`;
/** True for rows that are not transfers (meta row absent counts as not a transfer). */
export const notTransfer = sql`coalesce(${transactionMeta.isTransfer}, 0) = 0`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(date: string): boolean {
  return DATE_RE.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`));
}

// Escape LIKE metacharacters (\, %, _) so user search text matches literally; backslash must
// be escaped first so the escaping we add for % and _ isn't itself re-escaped.
export function escapeLikePattern(raw: string): string {
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
  // Dates are filtered on local_date, inclusive at both ends, because every bucketed query and
  // the Spending drill-down links (`from=<since>&to=<today>`) are in local days: comparing the
  // UTC instant instead makes the drill-down count disagree with the list it lands on.
  if (f.from && isValidDate(f.from)) parts.push(gte(transactions.localDate, f.from));
  if (f.to && isValidDate(f.to)) parts.push(lte(transactions.localDate, f.to));
  if (f.categoryId === "none") parts.push(isNull(transactionMeta.categoryId));
  else if (typeof f.categoryId === "number") parts.push(eq(transactionMeta.categoryId, f.categoryId));
  if (f.hideTransfers) parts.push(notTransfer);
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
    .leftJoin(transactionMeta, eq(transactionMeta.transactionId, transactions.id))
    .where(where)
    .get()!.n;
  const rows = db
    .select({
      t: transactions,
      accountName: sql<string>`coalesce(nullif(trim(${accounts.nickname}), ''), ${accounts.name})`,
      currency: accounts.currency,
      effectiveDate,
      categoryId: transactionMeta.categoryId,
      categoryName: categories.name,
      categorySource: transactionMeta.categorySource,
      isTransfer: sql<boolean>`coalesce(${transactionMeta.isTransfer}, 0)`.mapWith(Boolean),
      transferSource: transactionMeta.transferSource,
      debtId: debtPayments.debtId,
      debtName: externalDebts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(transactionMeta, eq(transactionMeta.transactionId, transactions.id))
    .leftJoin(categories, eq(categories.id, transactionMeta.categoryId))
    .leftJoin(debtPayments, eq(debtPayments.transactionId, transactions.id))
    .leftJoin(externalDebts, eq(externalDebts.id, debtPayments.debtId))
    .where(where)
    .orderBy(desc(effectiveDate), desc(transactions.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()
    .map((r) => ({
      ...r.t,
      accountName: r.accountName,
      currency: r.currency,
      effectiveDate: r.effectiveDate,
      categoryId: r.categoryId ?? null,
      categoryName: r.categoryName ?? null,
      categorySource: r.categorySource ?? null,
      isTransfer: r.isTransfer,
      transferSource: r.transferSource ?? null,
      debtId: r.debtId ?? null,
      debtName: r.debtName ?? null,
    }));
  return { rows, total, page, pageSize };
}

export function recentTransactions(db: Db, limit: number): TxRow[] {
  return listTransactions(db, { page: 1, pageSize: limit }).rows;
}
