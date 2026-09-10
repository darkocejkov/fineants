import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listSyncRuns } from "@/lib/queries/syncRuns";
import { isoToLocal, unixToDate } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { SyncButton } from "@/components/SyncButton";
import type { ErrItem } from "@/lib/simplefin/types";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  success: "status-success",
  partial: "status-partial",
  failed: "status-failed",
};

export default function ExplorerPage() {
  const db = getDb();
  const runs = listSyncRuns(db, 100);

  return (
    <>
      <section className="section section-lead">
        <div className="section-head">
          <h1 className="section-title">Explorer</h1>
          <p className="section-meta">up to 100 most recent</p>
        </div>
        <div className="hero-sync">
          <p className="small">Every request fineants has made to SimpleFin, with the raw response it got back.</p>
          <SyncButton />
        </div>
      </section>

      {runs.length === 0 ? (
        <section className="section">
          <EmptyState title="No sync runs yet.">
            Choose Sync now, or run <code>npm run sync</code>.
          </EmptyState>
        </section>
      ) : (
        <section className="section">
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col" className="ledger-date">
                    Started
                  </th>
                  <th scope="col">Trigger</th>
                  <th scope="col">Status</th>
                  <th scope="col">Window</th>
                  <th scope="col" className="ledger-num">
                    Accounts
                  </th>
                  <th scope="col" className="ledger-num">
                    Transactions
                  </th>
                  <th scope="col" className="ledger-num">
                    Pending removed
                  </th>
                  <th scope="col">Errors</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const errs = JSON.parse(r.errlist) as ErrItem[];
                  const errorText = r.error ?? errs.map((e) => e.code).join(", ");
                  const errorTitle = [r.error, ...errs.map((e) => `${e.code}: ${e.msg}`)].filter(Boolean).join("\n");
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/explorer/${r.id}`}>{r.id}</Link>
                      </td>
                      <td className="ledger-date">{isoToLocal(r.startedAt)}</td>
                      <td className="ledger-quiet">{r.trigger}</td>
                      <td className={STATUS_CLASS[r.status] ?? ""}>{r.status}</td>
                      <td>
                        {unixToDate(r.windowStart)} to {unixToDate(r.windowEnd)}
                      </td>
                      <td className="ledger-num">{r.accountsSeen}</td>
                      <td className="ledger-num">{r.transactionsUpserted}</td>
                      <td className="ledger-num">{r.pendingRemoved}</td>
                      <td className="ledger-truncate" title={errorTitle || undefined}>
                        {errorText || null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
