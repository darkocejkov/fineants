import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/queries/accounts";
import { listTransactions, type TxFilter } from "@/lib/queries/transactions";
import { TransactionFilters } from "@/components/TransactionFilters";
import { TransactionsTable, Pagination } from "@/components/TransactionsTable";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

function filterFromParams(sp: SP): TxFilter {
  return {
    accountId: one(sp.account),
    q: one(sp.q),
    from: one(sp.from),
    to: one(sp.to),
    page: Number(one(sp.page) ?? 1) || 1,
    pageSize: 50,
  };
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const db = getDb();
  const filter = filterFromParams(sp);
  const accounts = listAccounts(db, { includeHidden: true });
  // Hidden accounts stay out of "All accounts" but are shown when one is picked on purpose.
  const { rows, total, page, pageSize } = listTransactions(db, { ...filter, includeHidden: Boolean(filter.accountId) });
  const params = { account: filter.accountId, q: filter.q, from: filter.from, to: filter.to };

  return (
    <section className="section section-lead">
      <div className="section-head">
        <h1 className="section-title">Transactions</h1>
        <p className="section-meta">newest first</p>
      </div>
      <TransactionFilters accounts={accounts} current={filter} basePath="/transactions" />
      <TransactionsTable rows={rows} resetHref="/transactions" />
      <Pagination page={page} total={total} pageSize={pageSize} basePath="/transactions" params={params} />
    </section>
  );
}
