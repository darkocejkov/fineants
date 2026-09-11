import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { loadConfig } from "@/lib/config";
import { listAccounts, totalsByCurrency, displayName } from "@/lib/queries/accounts";
import { netWorthSeries } from "@/lib/queries/balances";
import { recentTransactions } from "@/lib/queries/transactions";
import { getSyncStatus, type SyncStatus } from "@/lib/queries/syncRuns";
import { totalsRemainingByCurrency, upcomingDebts } from "@/lib/queries/debts";
import { upcomingRecurring } from "@/lib/queries/recurring";
import { budgetMonth } from "@/lib/budget/month";
import { todayLocal, parseMonthKey, monthKey } from "@/lib/time";
import { unixToDate, relativeFromNow, isoToLocal } from "@/lib/format";
import { changeSentence } from "@/lib/sentences";
import { Amount } from "@/components/Amount";
import { EmptyState, NoAccountsEmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SyncButton } from "@/components/SyncButton";
import { StatusWord } from "@/components/StatusWord";
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

  const tz = loadConfig().timezone;
  const today = todayLocal(tz);
  const { year, month } = parseMonthKey(monthKey(today))!;
  const debts = totalsRemainingByCurrency(db);
  const upcoming = [...upcomingRecurring(db, { today, days: 7 }), ...upcomingDebts(db, { today, days: 7 })];
  const budget = budgetMonth(db, { year, month, tz, today });
  const upcomingByCurrency = new Map<string, { count: number; cents: number }>();
  for (const u of upcoming) {
    const cur = upcomingByCurrency.get(u.currency) ?? { count: 0, cents: 0 };
    cur.count += 1;
    cur.cents += u.amountCents;
    upcomingByCurrency.set(u.currency, cur);
  }

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
        {accounts.length > 0 ? (
          <dl className="facts">
            <dt>Debts</dt>
            <dd>
              {debts.length === 0 ? <Link href="/debts">none recorded</Link> : debts.map((d, i) => (
                <span key={d.currency}>{i > 0 ? "; " : ""}<Link href="/debts"><Amount cents={d.remainingCents} currency={d.currency} signColour={false} /> {d.currency}</Link> across {d.open === 1 ? "1 debt" : `${d.open} debts`}</span>
              ))}
            </dd>
            <dt>Due in 7 days</dt>
            <dd>
              {upcoming.length === 0 ? <Link href="/recurring">nothing due</Link> : [...upcomingByCurrency.entries()].map(([cur, v], i) => (
                <span key={cur}>{i > 0 ? "; " : ""}<Link href="/recurring">{v.count === 1 ? "1 item" : `${v.count} items`}</Link>, <Amount cents={v.cents} currency={cur} signColour={false} /> {cur}</span>
              ))}
            </dd>
            <dt>Budget</dt>
            <dd>
              {budget.totals.length === 0 ? <Link href="/budget">no caps set</Link> : budget.totals.map((t, i) => (
                <span key={t.currency}>{i > 0 ? "; " : ""}<Link href="/budget"><Amount cents={t.spentCents} currency={t.currency} signColour={false} /> of <Amount cents={t.capCents} currency={t.currency} signColour={false} /></Link> this month</span>
              ))}
            </dd>
          </dl>
        ) : null}
        <div className="hero-sync">
          <p className="small">{syncSentence(status.latest)}</p>
          <SyncButton />
        </div>
      </section>

      <ErrorBanner status={status} />

      {accounts.length === 0 ? (
        <section className="section">
          <NoAccountsEmptyState />
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
                      <th scope="col">Category</th>
                      <th scope="col" className="ledger-num">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((t) => (
                      <tr key={t.id} className={t.isTransfer ? "ledger-transfer" : undefined}>
                        <td className="ledger-date">
                          {unixToDate(t.effectiveDate)}
                          {t.pending ? <span className="ledger-pending">pending</span> : null}
                        </td>
                        <td className="ledger-quiet">{t.accountName}</td>
                        <td>
                          {t.payee || t.description}
                          {t.isTransfer ? (
                            <>
                              {" "}
                              <StatusWord tone="neutral">transfer</StatusWord>
                            </>
                          ) : null}
                        </td>
                        <td className="ledger-quiet">{t.categoryName ?? ""}</td>
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
