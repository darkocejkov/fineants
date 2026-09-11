import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { loadConfig } from "@/lib/config";
import { first, type SearchParams } from "@/lib/searchParams";
import { budgetMonth, budgetMonthRange, PACE_WORDS, type PaceState } from "@/lib/budget/month";
import { listCategories, dominantCurrency } from "@/lib/queries/categories";
import { monthKey, parseMonthKey, todayLocal } from "@/lib/time";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { FillRule } from "@/components/FillRule";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { StatusWord, type StatusTone } from "@/components/StatusWord";
import { setCategoryCapAction } from "./actions";

export const dynamic = "force-dynamic";

const PACE_TONE: Record<PaceState, StatusTone> = { on_pace: "good", over_pace: "attention", over_cap: "bad" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const db = getDb();
  const tz = loadConfig().timezone;
  const today = todayLocal(tz);
  const range = budgetMonthRange(db, today);
  const requested = first(sp.month);
  const parsed = requested ? parseMonthKey(requested) : null;
  const key = parsed && requested! >= range.earliest && requested! <= range.latest ? requested! : monthKey(today);
  const { year, month } = parseMonthKey(key)!;
  const b = budgetMonth(db, { year, month, tz, today });
  const currency = dominantCurrency(db) ?? "CAD";
  const categories = listCategories(db).filter((c) => c.kind === "expense");
  const error = first(sp.error);
  const saved = first(sp.saved);
  const isCurrent = key === monthKey(today);
  const daysLeft = b.daysInMonth - b.daysElapsed;

  return (
    <>
      <section className="section hero">
        <div className="section-head">
          <h1 className="section-title">Budget</h1>
          <p className="section-meta">{isCurrent ? `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left` : b.daysElapsed === 0 ? "not started" : "month closed"}</p>
        </div>
        <MonthSwitcher current={key} earliest={range.earliest} latest={range.latest} basePath="/budget" />
        {b.totals.length > 0 ? (
          b.totals.map((t) => (
            <div key={t.currency} className="hero-figure">
              <p className="stamp">
                <Amount cents={t.spentCents} currency={t.currency} signColour={false} />
                <span className="stamp-currency">{t.currency}</span>
              </p>
              <p className="hero-note">
                of <Amount cents={t.capCents} currency={t.currency} signColour={false} /> capped this month
                {t.spentCents > t.capCents ? ", over by " : ", "}
                <Amount cents={Math.abs(t.capCents - t.spentCents)} currency={t.currency} signColour={false} />
                {t.spentCents > t.capCents ? "." : " left."}
              </p>
            </div>
          ))
        ) : (
          <p className="hero-note">No caps yet. Set a monthly cap on a category below and this becomes your month at a glance.</p>
        )}
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Capped categories</h2>
          <p className="section-meta">spent against cap, {PACE_WORDS.on_pace} means under the day-of-month share</p>
        </div>
        {b.capped.length === 0 ? (
          <EmptyState title="No category has a cap.">Add one in the form on any row below.</EmptyState>
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="ledger-num">Spent</th>
                  <th scope="col" className="ledger-num">Cap</th>
                  <th scope="col" className="ledger-num">Left</th>
                  <th scope="col">Pace</th>
                  <th scope="col" className="ledger-fill"><span className="sr-only">Progress</span></th>
                  <th scope="col"><span className="sr-only">Edit cap</span></th>
                </tr>
              </thead>
              <tbody>
                {b.capped.map((c) => (
                  <tr key={c.categoryId}>
                    <td>
                      <Link href={`/transactions?category=${c.categoryId}&from=${b.startDate}&to=${b.endDate}`}>{c.name}</Link>
                    </td>
                    <td className="ledger-num"><Amount cents={c.spentCents} currency={c.currency} signColour={false} /></td>
                    <td className="ledger-num"><Amount cents={c.capCents} currency={c.currency} signColour={false} /></td>
                    <td className="ledger-num"><Amount cents={c.remainingCents} currency={c.currency} /></td>
                    <td><StatusWord tone={PACE_TONE[c.paceState]}>{PACE_WORDS[c.paceState]}</StatusWord></td>
                    <td className="ledger-fill"><FillRule spentCents={c.spentCents} capCents={c.capCents} /></td>
                    <td className="row-actions">
                      <form action={setCategoryCapAction} className="inline-form">
                        <input type="hidden" name="id" value={c.categoryId} />
                        <input type="hidden" name="month" value={key} />
                        <input type="hidden" name="capCurrency" value={c.currency} />
                        <input name="cap" inputMode="decimal" defaultValue={(c.capCents / 100).toFixed(2)} aria-label={`Monthly cap for ${c.name}`} className="inline-select" />
                        <button type="submit" className="row-action">Save cap</button>
                        {saved === String(c.categoryId) ? <span className="small">Saved</span> : null}
                      </form>
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
          <h2 className="section-title">Other spending</h2>
          <p className="section-meta">categories without a cap</p>
        </div>
        {b.uncapped.length === 0 && b.uncategorised.length === 0 ? (
          <EmptyState title="Nothing else went out this month." />
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="ledger-num">Spent</th>
                  <th scope="col"><span className="sr-only">Set cap</span></th>
                </tr>
              </thead>
              <tbody>
                {b.uncapped.map((c) => (
                  <tr key={`${c.categoryId}-${c.currency}`}>
                    <td>
                      <Link href={`/transactions?category=${c.categoryId}&from=${b.startDate}&to=${b.endDate}`}>{c.name}</Link>
                    </td>
                    <td className="ledger-num"><Amount cents={c.spentCents} currency={c.currency} signColour={false} /></td>
                    <td className="row-actions">
                      <form action={setCategoryCapAction} className="inline-form">
                        <input type="hidden" name="id" value={c.categoryId} />
                        <input type="hidden" name="month" value={key} />
                        <input type="hidden" name="capCurrency" value={c.currency} />
                        <input name="cap" inputMode="decimal" placeholder="set a cap" aria-label={`Monthly cap for ${c.name}`} className="inline-select" />
                        <button type="submit" className="row-action">Save cap</button>
                      </form>
                    </td>
                  </tr>
                ))}
                {b.uncategorised.map((u) => (
                  <tr key={`none-${u.currency}`}>
                    <td>
                      <Link href={`/transactions?category=none&from=${b.startDate}&to=${b.endDate}`}>Uncategorised</Link>{" "}
                      <span className="small">{u.count === 1 ? "1 transaction" : `${u.count} transactions`}</span>
                    </td>
                    <td className="ledger-num"><Amount cents={u.spentCents} currency={u.currency} signColour={false} /></td>
                    <td className="row-actions">
                      <Link className="row-action" href="/settings/rules">Add a rule</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {categories.some((c) => !b.capped.find((x) => x.categoryId === c.id) && !b.uncapped.find((x) => x.categoryId === c.id)) ? (
          <p className="small">Categories with no spending this month are not listed; set their caps under <Link href="/settings/categories">Settings</Link>.</p>
        ) : null}
      </section>

      {b.income.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Income</h2>
          </div>
          <div className="ledger-scroll">
            <table className="ledger">
              <tbody>
                {b.income.map((i) => (
                  <tr key={`${i.categoryId}-${i.currency}`}>
                    <td>{i.name}</td>
                    <td className="ledger-num"><Amount cents={i.inflowCents} currency={i.currency} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="footnote">
        Months run from the 1st to the last day in {tz}. Transfers between your own accounts and hidden accounts are left out. Pace compares
        what you have spent so far with the cap scaled to the days elapsed. Caps are per category in {currency} unless you set them otherwise
        under Settings.
      </p>
    </>
  );
}
