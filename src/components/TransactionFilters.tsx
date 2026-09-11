import Link from "next/link";
import type { AccountRow, CategoryRow } from "@/lib/db/schema";
import type { TxFilter } from "@/lib/queries/transactions";
import { displayName } from "@/lib/queries/accounts";

/**
 * A plain GET form, so filtering works without JavaScript and every result is a URL.
 * Submitting drops `page` from the query, which is what you want: a new filter starts at page 1.
 */
export function TransactionFilters({
  accounts,
  categories,
  current,
  basePath,
  hideAccountSelect = false,
}: {
  accounts: AccountRow[];
  categories: CategoryRow[];
  current: TxFilter;
  basePath: string;
  hideAccountSelect?: boolean;
}) {
  return (
    <form action={basePath} method="get" className="filters">
      {!hideAccountSelect ? (
        <label className="filter-field">
          <span className="small">Account</span>
          <select name="account" defaultValue={current.accountId ?? ""}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              // Hidden accounts are absent from "All accounts", so the option says why picking it changes the count.
              <option key={a.id} value={a.id}>
                {displayName(a)}
                {a.hidden ? " (hidden)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="filter-field filter-search">
        <span className="small">Search</span>
        <input name="q" defaultValue={current.q ?? ""} placeholder="description, payee, memo" />
      </label>
      <label className="filter-field">
        <span className="small">Category</span>
        <select
          name="category"
          defaultValue={current.categoryId === "none" ? "none" : current.categoryId === undefined ? "" : String(current.categoryId)}
        >
          <option value="">All categories</option>
          <option value="none">Uncategorised</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span className="small">From</span>
        <input type="date" name="from" defaultValue={current.from ?? ""} />
      </label>
      <label className="filter-field">
        <span className="small">To</span>
        <input type="date" name="to" defaultValue={current.to ?? ""} />
      </label>
      <label className="filter-field">
        <span className="small">Transfers</span>
        <select name="transfers" defaultValue={current.hideTransfers === false ? "show" : "hide"}>
          <option value="hide">Hidden</option>
          <option value="show">Shown</option>
        </select>
      </label>
      <div className="filter-actions">
        <button className="button button-primary" type="submit">
          Filter
        </button>
        <Link className="button" href={basePath}>
          Reset
        </Link>
      </div>
    </form>
  );
}
