import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getAccount, displayName } from "@/lib/queries/accounts";
import { accountBalanceSeries } from "@/lib/queries/balances";
import { listTransactions } from "@/lib/queries/transactions";
import { unixToDate } from "@/lib/format";
import { changeSentence } from "@/lib/sentences";
import { Amount } from "@/components/Amount";
import { BalanceChart } from "@/components/charts/BalanceChart";
import { TransactionFilters } from "@/components/TransactionFilters";
import { TransactionsTable, Pagination } from "@/components/TransactionsTable";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  // Next has already decoded the segment; decoding again throws URIError on an id like "%".
  const account = getAccount(db, id);
  if (!account) notFound();
  const basePath = `/accounts/${encodeURIComponent(account.id)}`;
  const filter = {
    accountId: account.id,
    q: one(sp.q),
    from: one(sp.from),
    to: one(sp.to),
    page: Number(one(sp.page) ?? 1) || 1,
    pageSize: 50,
    includeHidden: true,
  };
  const { rows, total, page, pageSize } = listTransactions(db, filter);
  const series = accountBalanceSeries(db, account.id, 365);
  const name = displayName(account);
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
        <TransactionFilters accounts={[]} current={filter} basePath={basePath} hideAccountSelect />
        {pastEnd ? null : <TransactionsTable rows={rows} showAccount={false} resetHref={basePath} />}
        <Pagination
          page={page}
          total={total}
          pageSize={pageSize}
          basePath={basePath}
          params={{ q: filter.q, from: filter.from, to: filter.to }}
        />
      </section>
    </>
  );
}
