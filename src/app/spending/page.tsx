import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { first, type SearchParams } from "@/lib/searchParams";
import { listAccounts } from "@/lib/queries/accounts";
import { spendingByPeriod, topPayees, spendingByCategory, type Granularity } from "@/lib/queries/spending";
import { loadConfig } from "@/lib/config";
import { addDays, todayLocal } from "@/lib/time";
import { Amount } from "@/components/Amount";
import { EmptyState, NoAccountsEmptyState } from "@/components/EmptyState";
import { SpendingChart } from "@/components/charts/SpendingChart";

export const dynamic = "force-dynamic";

const RANGES = {
  "7d": { days: 7, g: "day", label: "7 days", words: "the last 7 days" },
  "30d": { days: 30, g: "day", label: "30 days", words: "the last 30 days" },
  "90d": { days: 90, g: "week", label: "90 days", words: "the last 90 days" },
  "12m": { days: 365, g: "month", label: "12 months", words: "the last 12 months" },
} as const;
type RangeKey = keyof typeof RANGES;
const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];

const GRANULARITIES: Granularity[] = ["day", "week", "month"];
const GRANULARITY_LABEL: Record<Granularity, string> = { day: "By day", week: "By week", month: "By month" };
const PERIOD_WORDS: Record<Granularity, { one: string; many: string }> = {
  day: { one: "day", many: "days" },
  week: { one: "week", many: "weeks" },
  month: { one: "month", many: "months" },
};

export default async function SpendingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const rangeParam = first(sp.range);
  const rangeKey: RangeKey = rangeParam && rangeParam in RANGES ? (rangeParam as RangeKey) : "30d";
  const range = RANGES[rangeKey];
  const gParam = first(sp.g) as Granularity | undefined;
  const granularity: Granularity = gParam && GRANULARITIES.includes(gParam) ? gParam : range.g;

  const db = getDb();
  const tz = loadConfig().timezone;
  const today = todayLocal(tz);
  // Nothing has ever synced, so the range selector cannot be widened into any data.
  const neverSynced = listAccounts(db, { includeHidden: true }).length === 0;
  const since = addDays(today, -range.days);
  const all = spendingByPeriod(db, { days: range.days, granularity, today });
  const currencies = [...new Set(all.map((r) => r.currency))];
  const outflowByCurrency = new Map<string, number>();
  for (const r of all) outflowByCurrency.set(r.currency, (outflowByCurrency.get(r.currency) ?? 0) + r.outflowCents);
  const largestOutflow = [...outflowByCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const currencyParam = first(sp.currency);
  const currency = currencyParam && currencies.includes(currencyParam) ? currencyParam : largestOutflow;

  const rows = all.filter((r) => r.currency === currency);
  const totalOut = rows.reduce((n, r) => n + r.outflowCents, 0);
  const totalIn = rows.reduce((n, r) => n + r.inflowCents, 0);
  const payees = topPayees(db, { days: range.days, today, limit: 10 }).filter((p) => p.currency === currency);
  const byCategory = spendingByCategory(db, { sinceDate: since }).filter((c) => c.currency === currency);
  const words = PERIOD_WORDS[granularity];
  const periodCount = `${rows.length} ${rows.length === 1 ? words.one : words.many} with activity`;

  // Changing the range resets the grouping to that range's default; everything else is carried.
  const link = (patch: { range?: RangeKey; g?: Granularity; currency?: string }) => {
    const q = new URLSearchParams();
    q.set("range", patch.range ?? rangeKey);
    q.set("g", patch.g ?? granularity);
    const c = patch.currency ?? currency;
    if (c) q.set("currency", c);
    return `/spending?${q.toString()}`;
  };
  const choice = (current: boolean) => (current ? "choice choice-current" : "choice");

  return (
    <>
      <section className="section hero">
        <div className="section-head">
          <h1 className="section-title">Spending</h1>
          <p className="section-meta">since {since}</p>
        </div>

        <div className="choices">
          <div className="choice-group" role="group" aria-label="Range">
            {RANGE_KEYS.map((k) => (
              <Link
                key={k}
                href={link({ range: k, g: RANGES[k].g })}
                aria-current={k === rangeKey ? "true" : undefined}
                className={choice(k === rangeKey)}
              >
                {RANGES[k].label}
              </Link>
            ))}
          </div>
          <div className="choice-group" role="group" aria-label="Grouping">
            {GRANULARITIES.map((g) => (
              <Link
                key={g}
                href={link({ g })}
                aria-current={g === granularity ? "true" : undefined}
                className={choice(g === granularity)}
              >
                {GRANULARITY_LABEL[g]}
              </Link>
            ))}
          </div>
          {/* One currency needs no choosing, and its code is already beside the figure. */}
          {currencies.length > 1 ? (
            <div className="choice-group" role="group" aria-label="Currency">
              {currencies.map((c) => (
                <Link
                  key={c}
                  href={link({ currency: c })}
                  aria-current={c === currency ? "true" : undefined}
                  className={choice(c === currency)}
                >
                  {c}
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        {currency ? (
          <>
            {/* The one bold element on the page: what went out. Received and net are sentences. */}
            <p className="stamp">
              <Amount cents={totalOut} currency={currency} signColour={false} />
              <span className="stamp-currency">{currency}</span>
            </p>
            <p className="hero-note">
              Received <Amount cents={totalIn} currency={currency} signColour={false} />, net{" "}
              <Amount cents={totalIn - totalOut} currency={currency} signColour={false} />, over {range.words}.
            </p>
          </>
        ) : neverSynced ? (
          <NoAccountsEmptyState />
        ) : (
          <EmptyState title="No transactions in this range.">Sync first, or choose a longer range.</EmptyState>
        )}
      </section>

      {currency ? (
        <>
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Spending by {granularity}</h2>
              <p className="section-meta">{periodCount}</p>
            </div>
            <SpendingChart rows={rows} currency={currency} />
          </section>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">By category</h2>
              <p className="section-meta">largest first</p>
            </div>
            {byCategory.length === 0 ? (
              <EmptyState title="Nothing went out in this range." />
            ) : (
              <div className="ledger-scroll">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col" className="ledger-num">Transactions</th>
                      <th scope="col" className="ledger-num">Spent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCategory.map((c) => (
                      <tr key={c.categoryId ?? "none"}>
                        <td>
                          <Link href={`/transactions?category=${c.categoryId ?? "none"}&from=${since}&to=${today}`}>{c.name}</Link>
                        </td>
                        <td className="ledger-num">{c.count}</td>
                        <td className="ledger-num">
                          <Amount cents={c.outflowCents} currency={currency} signColour={false} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Top payees</h2>
              <p className="section-meta">up to 10, largest first</p>
            </div>
            {payees.length === 0 ? (
              <EmptyState title="Nothing went out in this range.">
                Every {currency} transaction brought money in, so there is nothing to rank.
              </EmptyState>
            ) : (
              <div className="ledger-scroll">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th scope="col">Payee</th>
                      <th scope="col" className="ledger-num">
                        Transactions
                      </th>
                      <th scope="col" className="ledger-num">
                        Spent
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {payees.map((p) => (
                      <tr key={p.label}>
                        <td>{p.label}</td>
                        <td className="ledger-num">{p.count}</td>
                        {/* Every figure in this column is money out, so a minus sign and a red
                            would repeat the heading rather than tell them apart. */}
                        <td className="ledger-num">
                          <Amount cents={p.outflowCents} currency={currency} signColour={false} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="footnote">
            Transfers between your own accounts are left out. Hidden accounts are excluded. Periods with no activity are
            left out of the chart. Days and months follow {tz}. Uncategorised spending is listed by category as
            &ldquo;Uncategorised&rdquo;; add rules under Settings to sort it.
          </p>
        </>
      ) : null}
    </>
  );
}
