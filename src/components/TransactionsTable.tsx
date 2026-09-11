import Link from "next/link";
import type { TxRow } from "@/lib/queries/transactions";
import type { CategoryRow } from "@/lib/db/schema";
import { Amount } from "./Amount";
import { EmptyState } from "./EmptyState";
import { unixToDate } from "@/lib/format";
import { InlineCategorySelect } from "./InlineCategorySelect";
import { StatusWord } from "./StatusWord";
import { setTransactionCategory, setTransactionTransfer } from "@/app/transactions/actions";

export function TransactionsTable({
  rows,
  categories,
  returnTo,
  showAccount = true,
  resetHref,
}: {
  rows: TxRow[];
  categories: CategoryRow[];
  returnTo: string;
  showAccount?: boolean;
  resetHref?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No transactions match these filters.">
        {resetHref ? (
          <>
            Widen the dates, clear the search, or <Link href={resetHref}>reset the filters</Link>.
          </>
        ) : (
          "Widen the dates or clear the search."
        )}
      </EmptyState>
    );
  }
  return (
    <div className="ledger-scroll">
      <table className="ledger">
        <thead>
          <tr>
            <th scope="col" className="ledger-date">
              Date
            </th>
            {showAccount ? <th scope="col">Account</th> : null}
            <th scope="col">Payee</th>
            <th scope="col">Description</th>
            <th scope="col">Category</th>
            <th scope="col">Memo</th>
            <th scope="col" className="ledger-num">
              Amount
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className={t.isTransfer ? "ledger-transfer" : undefined}>
              <td className="ledger-date">
                {unixToDate(t.effectiveDate)}
                {t.pending ? <span className="ledger-pending">pending</span> : null}
              </td>
              {showAccount ? (
                <td>
                  <Link href={`/accounts/${encodeURIComponent(t.accountId)}`}>{t.accountName}</Link>
                </td>
              ) : null}
              <td>
                {t.payee ?? ""}
                {t.isTransfer ? (
                  <>
                    {" "}
                    <StatusWord tone="neutral">transfer</StatusWord>
                  </>
                ) : null}
              </td>
              <td>{t.description}</td>
              <td>
                <form action={setTransactionCategory} className="inline-form">
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <InlineCategorySelect
                    categories={categories}
                    value={t.categoryId}
                    manual={t.categorySource === "manual"}
                    label={`Category for ${t.payee ?? t.description}`}
                  />
                </form>
              </td>
              <td className="ledger-quiet">{t.memo ?? ""}</td>
              <td className={t.pending ? "ledger-num ledger-num-pending" : "ledger-num"}>
                <Amount cents={t.amountCents} currency={t.currency} />
              </td>
              <td className="row-actions">
                <form action={setTransactionTransfer}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="transfer" value={t.isTransfer ? "0" : "1"} />
                  <button type="submit" className="row-action">
                    {t.isTransfer ? "Not a transfer" : "Mark as transfer"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  total,
  pageSize,
  basePath,
  params,
}: {
  page: number;
  total: number;
  pageSize: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  // With nothing to page through, the empty state above is the whole story.
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  // Past the last page there are rows, just not here, so say that rather than "nothing matches".
  if (page > pages) {
    return (
      <div className="pagination">
        <p className="small">
          Page {page} does not exist. This list has {pages === 1 ? "1 page" : `${pages} pages`}.
        </p>
        <div className="pagination-steps">
          <Link className="button" href={href(pages)}>
            Go to last page
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="pagination">
      <p className="small">
        {total === 1 ? "1 transaction" : `${total} transactions`}, page {page} of {pages}
      </p>
      {pages > 1 ? (
        <div className="pagination-steps">
          {page > 1 ? (
            <Link className="button" href={href(page - 1)}>
              Previous
            </Link>
          ) : null}
          {page < pages ? (
            <Link className="button" href={href(page + 1)}>
              Next
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
