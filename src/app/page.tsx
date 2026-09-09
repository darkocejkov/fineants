import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listAccounts, totalsByCurrency, displayName } from "@/lib/queries/accounts";
import { netWorthSeries } from "@/lib/queries/balances";
import { recentTransactions } from "@/lib/queries/transactions";
import { getSyncStatus, type SyncStatus } from "@/lib/queries/syncRuns";
import { unixToDate, relativeFromNow, isoToLocal } from "@/lib/format";
import { changeSentence } from "@/lib/sentences";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SyncButton } from "@/components/SyncButton";
import { NetWorthChart } from "@/components/charts/NetWorthChart";

export const dynamic = "force-dynamic";

function syncSentence(latest: SyncStatus["latest"]): string {
  if (!latest) return "Nothing has synced yet.";
  const when = relativeFromNow(latest.finishedAt ?? latest.startedAt);
  if (latest.status === "running") return `A sync started ${when} and is still running.`;
  const verb = latest.status === "success" ? "finished" : latest.status === "partial" ? "finished with errors" : "failed";
  return `The last sync ${verb} ${when}, at ${isoToLocal(latest.finishedAt)}.`;
}

export default function OverviewPage() {
  const db = getDb();
  const status = getSyncStatus(db);
  const accounts = listAccounts(db);
  const totals = totalsByCurrency(db);
  const series = netWorthSeries(db, 365);
  const recent = recentTransactions(db, 20);
  const pointsFor = new Map(series.map((s) => [s.currency, s.points]));

  return (
    <>
      <h1 className="sr-only">Overview</h1>

      <section className="section hero">
        {totals.map((t) => (
          <div key={t.currency} className="hero-figure">
            <p className="stamp">
              <Amount cents={t.balanceCents} currency={t.currency} signColour={false} />
              <span className="stamp-currency">{t.currency}</span>
            </p>
            <p className="hero-note">{changeSentence(pointsFor.get(t.currency) ?? [], t.currency)}</p>
          </div>
        ))}
        <div className="hero-sync">
          <p className="small">{syncSentence(status.latest)}</p>
          <SyncButton />
        </div>
      </section>

      <ErrorBanner status={status} />

      {accounts.length === 0 ? (
        <section className="section">
          <EmptyState title="No accounts yet">
            Run <code>npm run claim</code> with your setup token, put the access URL it prints into{" "}
            <code>SIMPLEFIN_ACCESS_URL</code> in <code>.env</code>, then choose Sync now. The{" "}
            <Link href="/explorer">explorer</Link> shows the raw SimpleFin responses.
          </EmptyState>
        </section>
      ) : (
        <>
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Net worth over time</h2>
              <p className="section-meta">last 365 days</p>
            </div>
            <NetWorthChart series={series} />
          </section>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Accounts</h2>
              <p className="section-meta">{accounts.length === 1 ? "1 account" : `${accounts.length} accounts`}</p>
            </div>
            <div className="ledger-scroll">
              <table className="ledger">
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="ledger-date">
                      As of
                    </th>
                    <th scope="col" className="ledger-num">
                      Balance
                    </th>
                    <th scope="col" className="ledger-num">
                      Available
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/accounts/${encodeURIComponent(a.id)}`}>{displayName(a)}</Link>
                      </td>
                      <td className="ledger-quiet">{a.type ?? "unclassified"}</td>
                      <td className="ledger-date">{unixToDate(a.balanceDate)}</td>
                      <td className="ledger-num">
                        <Amount cents={a.balanceCents} currency={a.currency} />
                      </td>
                      <td className="ledger-num">
                        {a.availableBalanceCents !== null ? (
                          <Amount cents={a.availableBalanceCents} currency={a.currency} signColour={false} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Recent transactions</h2>
              {recent.length > 0 ? (
                <p className="section-meta">
                  {recent.length} most recent, or see <Link href="/transactions">all transactions</Link>
                </p>
              ) : null}
            </div>
            {recent.length === 0 ? (
              <EmptyState title="No transactions yet">
                Choose Sync now to pull the last 365 days of activity from SimpleFin.
              </EmptyState>
            ) : (
              <div className="ledger-scroll">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th scope="col" className="ledger-date">
                        Date
                      </th>
                      <th scope="col">Account</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="ledger-num">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((t) => (
                      <tr key={t.id}>
                        <td className="ledger-date">
                          {unixToDate(t.effectiveDate)}
                          {t.pending ? <span className="ledger-pending">pending</span> : null}
                        </td>
                        <td className="ledger-quiet">{t.accountName}</td>
                        <td>{t.payee || t.description}</td>
                        <td className={t.pending ? "ledger-num ledger-num-pending" : "ledger-num"}>
                          <Amount cents={t.amountCents} currency={t.currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
