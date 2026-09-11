import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { first, type SearchParams } from "@/lib/searchParams";
import { getAccount, displayName } from "@/lib/queries/accounts";
import { accountBalanceSeries } from "@/lib/queries/balances";
import { listTransactions, type TxFilter } from "@/lib/queries/transactions";
import { listCategories } from "@/lib/queries/categories";
import { unixToDate } from "@/lib/format";
import { changeSentence } from "@/lib/sentences";
import { Amount } from "@/components/Amount";
import { BalanceChart } from "@/components/charts/BalanceChart";
import { TransactionFilters } from "@/components/TransactionFilters";
import { TransactionsTable, Pagination } from "@/components/TransactionsTable";

export const dynamic = "force-dynamic";

function currentHref(basePath: string, sp: SearchParams): string {
  const q = new URLSearchParams();
  for (const k of ["q", "from", "to", "category", "transfers", "page"]) {
    const v = first(sp[k]);
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  // Next has already decoded the segment; decoding again throws URIError on an id like "%".
  const account = getAccount(db, id);
  if (!account) notFound();
  const basePath = `/accounts/${encodeURIComponent(account.id)}`;
  const cat = first(sp.category);
  const filter: TxFilter = {
    accountId: account.id,
    q: first(sp.q),
    from: first(sp.from),
    to: first(sp.to),
    categoryId: cat === "none" ? "none" : cat && /^\d+$/.test(cat) ? Number(cat) : undefined,
    hideTransfers: first(sp.transfers) !== "show",
    page: Number(first(sp.page) ?? 1) || 1,
    pageSize: 50,
    includeHidden: true,
  };
  const { rows, total, page, pageSize } = listTransactions(db, filter);
  const categories = listCategories(db, { includeArchived: true });
  const activeCategories = categories.filter((c) => !c.archived);
  const series = accountBalanceSeries(db, account.id, 365);
  const name = displayName(account);
  const returnTo = currentHref(basePath, sp);
  // Beyond the last page the pagination line explains itself; an empty state would misread as "no matches".
  const pastEnd = total > 0 && rows.length === 0;

  return (
    <>
      <section className="section hero">
        <div className="section-head">
          <h1 className="section-title">{name}</h1>
          <p className="section-meta">
            as of {unixToDate(account.balanceDate)}
            {account.availableBalanceCents !== null ? (
              <>
                , <Amount cents={account.availableBalanceCents} currency={account.currency} signColour={false} /> available
              </>
            ) : null}
          </p>
        </div>
        <p className="stamp">
          <Amount cents={account.balanceCents} currency={account.currency} signColour={false} />
          <span className="stamp-currency">{account.currency}</span>
        </p>
        <p className="hero-note">{changeSentence(series, account.currency)}</p>
        <p className="hero-note small">
          {/* Only worth saying when a nickname has replaced it in the heading above. */}
          {name === account.name ? null : `Your bank calls this ${account.name}. `}
          Set as {account.type ?? "unclassified"}
          {account.hidden ? ", hidden from totals" : ""}. <Link href="/settings">Edit in settings</Link>.
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Balance history</h2>
          <p className="section-meta">last 365 days</p>
        </div>
        <BalanceChart points={series} currency={account.currency} />
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Transactions</h2>
          <p className="section-meta">newest first</p>
        </div>
        <TransactionFilters accounts={[]} categories={activeCategories} current={filter} basePath={basePath} hideAccountSelect />
        {pastEnd ? null : (
          <TransactionsTable rows={rows} categories={categories} returnTo={returnTo} showAccount={false} resetHref={basePath} />
        )}
        <Pagination
          page={page}
          total={total}
          pageSize={pageSize}
          basePath={basePath}
          params={{ q: filter.q, from: filter.from, to: filter.to, category: cat, transfers: first(sp.transfers) }}
        />
      </section>
    </>
  );
}
