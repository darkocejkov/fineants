import { getDb } from "@/lib/db/client";
import { first, type SearchParams } from "@/lib/searchParams";
import { listAccounts } from "@/lib/queries/accounts";
import { listTransactions, type TxFilter } from "@/lib/queries/transactions";
import { listCategories } from "@/lib/queries/categories";
import { NoAccountsEmptyState } from "@/components/EmptyState";
import { TransactionFilters } from "@/components/TransactionFilters";
import { TransactionsTable, Pagination } from "@/components/TransactionsTable";

export const dynamic = "force-dynamic";

function filterFromParams(sp: SearchParams): TxFilter {
  const cat = first(sp.category);
  return {
    accountId: first(sp.account),
    q: first(sp.q),
    from: first(sp.from),
    to: first(sp.to),
    categoryId: cat === "none" ? "none" : cat && /^\d+$/.test(cat) ? Number(cat) : undefined,
    hideTransfers: first(sp.transfers) !== "show",
    page: Number(first(sp.page) ?? 1) || 1,
    pageSize: 50,
  };
}

function currentHref(basePath: string, sp: SearchParams): string {
  const q = new URLSearchParams();
  for (const k of ["account", "q", "from", "to", "category", "transfers", "page"]) {
    const v = first(sp[k]);
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const db = getDb();
  const filter = filterFromParams(sp);
  const accounts = listAccounts(db, { includeHidden: true });

  // No accounts at all means nothing has ever synced, so there is nothing to filter and
  // nothing to page: advice about filters the user never set would be a dead end.
  if (accounts.length === 0) {
    return (
      <section className="section section-lead">
        <div className="section-head">
          <h1 className="section-title">Transactions</h1>
        </div>
        <NoAccountsEmptyState />
      </section>
    );
  }

  // Hidden accounts stay out of "All accounts" but are shown when one is picked on purpose.
  const { rows, total, page, pageSize } = listTransactions(db, { ...filter, includeHidden: Boolean(filter.accountId) });
  const categories = listCategories(db, { includeArchived: true });
  const activeCategories = categories.filter((c) => !c.archived);
  const cat = first(sp.category);
  const params = {
    account: filter.accountId,
    q: filter.q,
    from: filter.from,
    to: filter.to,
    category: cat,
    transfers: first(sp.transfers),
  };
  const returnTo = currentHref("/transactions", sp);
  // Beyond the last page the pagination line explains itself; an empty state would misread as "no matches".
  const pastEnd = total > 0 && rows.length === 0;

  return (
    <section className="section section-lead">
      <div className="section-head">
        <h1 className="section-title">Transactions</h1>
        <p className="section-meta">newest first</p>
      </div>
      <TransactionFilters accounts={accounts} categories={activeCategories} current={filter} basePath="/transactions" />
      {pastEnd ? null : <TransactionsTable rows={rows} categories={categories} returnTo={returnTo} resetHref="/transactions" />}
      <Pagination page={page} total={total} pageSize={pageSize} basePath="/transactions" params={params} />
    </section>
  );
}
