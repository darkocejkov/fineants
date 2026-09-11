import { Fragment } from "react";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { loadConfig } from "@/lib/config";
import { first, type SearchParams } from "@/lib/searchParams";
import { listDebtsWithStatus, lenders, totalsRemainingByCurrency } from "@/lib/queries/debts";
import { dominantCurrency } from "@/lib/queries/categories";
import { DEBT_KINDS, CADENCES } from "@/lib/db/schema";
import { DEBT_STATUS_WORDS } from "@/lib/debts/schedule";
import { todayLocal } from "@/lib/time";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { StatusWord } from "@/components/StatusWord";
import { createDebtAction } from "./actions";
import { DEBT_TONE, KIND_LABEL, CADENCE_LABEL } from "./labels";

export const dynamic = "force-dynamic";

export default async function DebtsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const db = getDb();
  const today = todayLocal(loadConfig().timezone);
  const showClosed = first(sp.closed) === "1";
  const rows = listDebtsWithStatus(db, { today, includeClosed: showClosed });
  const totals = totalsRemainingByCurrency(db);
  const knownLenders = lenders(db);
  const currency = dominantCurrency(db) ?? "CAD";
  const error = first(sp.error);

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.lender.toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <>
      <section className="section hero">
        <div className="section-head">
          <h1 className="section-title">Debts</h1>
          <p className="section-meta">{totals.reduce((n, t) => n + t.open, 0) === 1 ? "1 open" : `${totals.reduce((n, t) => n + t.open, 0)} open`}</p>
        </div>
        {totals.map((t) => (
          <div key={t.currency} className="hero-figure">
            <p className="stamp">
              <Amount cents={t.remainingCents} currency={t.currency} signColour={false} />
              <span className="stamp-currency">{t.currency}</span>
            </p>
            <p className="hero-note">still owed outside your bank accounts. Not counted in net worth.</p>
          </div>
        ))}
        {totals.length === 0 ? <p className="hero-note">Nothing owed outside your accounts. Add a plan or loan below to track it.</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">By lender</h2>
          <p className="section-meta">
            <Link href={showClosed ? "/debts" : "/debts?closed=1"}>{showClosed ? "hide closed" : "show closed"}</Link>
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No debts recorded." />
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Debt</th>
                  <th scope="col">Kind</th>
                  <th scope="col" className="ledger-num">Remaining</th>
                  <th scope="col" className="ledger-date">Next due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...groups.values()].map((list) => {
                  const lender = list[0].lender;
                  const byCurrency = new Map<string, number>();
                  for (const r of list) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.remainingCents);
                  const subtotal = [...byCurrency.entries()].map(([currency, remainingCents]) => ({ currency, remainingCents }));
                  return (
                    <Fragment key={lender}>
                      {list.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Link href={`/debts/${r.id}`}>{r.name}</Link> <span className="ledger-quiet">{r.lender}</span>
                            {r.closedAt ? <span className="small"> closed</span> : null}
                          </td>
                          <td className="ledger-quiet">{KIND_LABEL[r.kind]}</td>
                          <td className="ledger-num"><Amount cents={r.remainingCents} currency={r.currency} signColour={false} /></td>
                          <td className="ledger-date">{r.nextDue ?? ""}</td>
                          <td><StatusWord tone={DEBT_TONE[r.status]}>{DEBT_STATUS_WORDS[r.status]}</StatusWord></td>
                        </tr>
                      ))}
                      {list.length > 1
                        ? subtotal.map((t) => (
                            <tr key={`${lender}-${t.currency}`} className="ledger-group">
                              <td colSpan={2}>{lender} total</td>
                              <td className="ledger-num"><Amount cents={t.remainingCents} currency={t.currency} signColour={false} /></td>
                              <td colSpan={2} />
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Add a debt</h2>
        </div>
        <form action={createDebtAction} className="form">
          <div className="form-row">
            <label className="form-field">
              <span>What it is for</span>
              <input name="name" required placeholder="Couch" />
            </label>
            <label className="form-field">
              <span>Lender</span>
              <input name="lender" required list="lenders" placeholder="Affirm" />
              <datalist id="lenders">
                {knownLenders.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Kind</span>
              <select name="kind" defaultValue="bnpl">
                {DEBT_KINDS.map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Currency</span>
              <input name="currency" defaultValue={currency} />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Principal</span>
              <input name="principal" inputMode="decimal" required />
            </label>
            <label className="form-field">
              <span>Opened on</span>
              <input type="date" name="openedOn" defaultValue={today} required />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Interest-free until (optional)</span>
              <input type="date" name="interestFreeUntil" />
            </label>
            <label className="form-field">
              <span>Must be paid in full by (optional)</span>
              <input type="date" name="payoffDueOn" />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>APR % (optional, shown only)</span>
              <input name="apr" inputMode="decimal" />
            </label>
            <label className="form-field">
              <span>Payment day of month (loans, optional)</span>
              <input name="dueDay" inputMode="numeric" />
            </label>
          </div>
          <p className="form-note">Instalment plans: fill in all three of amount, how often, and first instalment date. Leave them blank for a deferred plan or an open loan.</p>
          <div className="form-row">
            <label className="form-field">
              <span>Instalment amount</span>
              <input name="instalmentAmount" inputMode="decimal" />
            </label>
            <label className="form-field">
              <span>How often</span>
              <select name="cadence" defaultValue="">
                <option value="">no schedule</option>
                {CADENCES.map((c) => (
                  <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>First instalment on</span>
              <input type="date" name="firstInstalmentOn" />
            </label>
            <label className="form-field">
              <span>Number of instalments (blank = until paid off)</span>
              <input name="instalmentCount" inputMode="numeric" />
            </label>
          </div>
          <label className="form-field">
            <span>Every N days (custom cadence only)</span>
            <input name="intervalDays" inputMode="numeric" />
          </label>
          <label className="form-field">
            <span>Notes (optional)</span>
            <input name="notes" />
          </label>
          <div className="form-actions">
            <button className="button button-primary" type="submit">Add debt</button>
          </div>
        </form>
      </section>
    </>
  );
}
