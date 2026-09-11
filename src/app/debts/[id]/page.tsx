import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { loadConfig } from "@/lib/config";
import { first, type SearchParams } from "@/lib/searchParams";
import { getDebt, listPayments, candidateTransactions } from "@/lib/queries/debts";
import { debtStatus, nextDue, projectedInstalments, remainingCents, hasSchedule, DEBT_STATUS_WORDS } from "@/lib/debts/schedule";
import { CADENCES, DEBT_KINDS } from "@/lib/db/schema";
import { formatCents } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { StatusWord } from "@/components/StatusWord";
import { DEBT_TONE, KIND_LABEL, CADENCE_LABEL } from "../labels";
import { addPaymentAction, deletePaymentAction, linkTransactionAction, setDebtClosedAction, deleteDebtAction, updateDebtAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DebtPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const sp = await searchParams;
  const db = getDb();
  const debt = getDebt(db, Number(id));
  if (!debt) notFound();
  const today = todayLocal(loadConfig().timezone);
  const payments = listPayments(db, debt.id);
  const remaining = Math.max(0, remainingCents(debt, payments));
  const status = debtStatus(debt, payments, today);
  const due = nextDue(debt, payments, today);
  const schedule = projectedInstalments(debt, payments, today);
  const error = first(sp.error);
  const saved = first(sp.saved);
  const editing = first(sp.edit) === "1";
  const q = first(sp.q) ?? "";
  const amountParam = first(sp.amount);
  const amountCents = amountParam ? Math.round(Number(amountParam.replace(/[,$\s]/g, "")) * 100) : undefined;
  const candidates = candidateTransactions(db, { q: q || undefined, amountCents: amountCents && Number.isFinite(amountCents) ? amountCents : undefined, currency: debt.currency, limit: 20 });
  const self = `/debts/${debt.id}`;
  const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));

  return (
    <>
      <section className="section hero">
        <p className="small"><Link href="/debts">All debts</Link></p>
        <div className="section-head">
          <h1 className="section-title">{debt.name} <span className="ledger-quiet">{debt.lender}</span></h1>
          <p className="section-meta"><StatusWord tone={DEBT_TONE[status]}>{DEBT_STATUS_WORDS[status]}</StatusWord></p>
        </div>
        <div className="hero-figure">
          <p className="stamp">
            <Amount cents={remaining} currency={debt.currency} signColour={false} />
            <span className="stamp-currency">{debt.currency}</span>
          </p>
          <p className="hero-note">
            remaining of <Amount cents={debt.principalCents} currency={debt.currency} signColour={false} />
            {due ? `, next due ${due}.` : "."}
            {remainingCents(debt, payments) < 0 ? ` Overpaid by ${formatCents(-remainingCents(debt, payments), debt.currency)}.` : ""}
          </p>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {saved === "link" ? <p className="small">Transaction linked.</p> : saved === "payment" ? <p className="small">Payment added.</p> : saved === "1" ? <p className="small">Saved.</p> : null}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Terms</h2>
          <p className="section-meta"><Link href={editing ? self : `${self}?edit=1`}>{editing ? "Stop editing" : "Edit"}</Link></p>
        </div>
        {!editing ? (
          <dl className="facts">
            <dt>Kind</dt><dd>{KIND_LABEL[debt.kind]}</dd>
            <dt>Opened</dt><dd>{debt.openedOn}</dd>
            {debt.interestFreeUntil ? <><dt>Interest-free until</dt><dd>{debt.interestFreeUntil}</dd></> : null}
            {debt.payoffDueOn ? <><dt>Pay in full by</dt><dd>{debt.payoffDueOn}</dd></> : null}
            {debt.aprBps !== null ? <><dt>APR</dt><dd>{(debt.aprBps / 100).toFixed(2)}% (shown only; interest is not calculated)</dd></> : null}
            {debt.dueDay ? <><dt>Payment day</dt><dd>the {debt.dueDay}th of each month</dd></> : null}
            {hasSchedule(debt) ? <><dt>Schedule</dt><dd>{formatCents(debt.instalmentAmountCents!, debt.currency)} {debt.cadence === "custom_days" ? `every ${debt.intervalDays} days` : CADENCE_LABEL[debt.cadence!]} from {debt.firstInstalmentOn}{debt.instalmentCount ? `, ${debt.instalmentCount} instalments` : ", until paid off"}</dd></> : null}
            {debt.notes ? <><dt>Notes</dt><dd>{debt.notes}</dd></> : null}
          </dl>
        ) : (
          <form action={updateDebtAction} className="form">
            <input type="hidden" name="id" value={debt.id} />
            <div className="form-row">
              <label className="form-field"><span>What it is for</span><input name="name" defaultValue={debt.name} required /></label>
              <label className="form-field"><span>Lender</span><input name="lender" defaultValue={debt.lender} required /></label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>Kind</span>
                <select name="kind" defaultValue={debt.kind}>{DEBT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
              </label>
              <label className="form-field"><span>Currency</span><input name="currency" defaultValue={debt.currency} /></label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>Principal</span><input name="principal" inputMode="decimal" defaultValue={dollars(debt.principalCents)} required /></label>
              <label className="form-field"><span>Opened on</span><input type="date" name="openedOn" defaultValue={debt.openedOn} required /></label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>Interest-free until</span><input type="date" name="interestFreeUntil" defaultValue={debt.interestFreeUntil ?? ""} /></label>
              <label className="form-field"><span>Must be paid in full by</span><input type="date" name="payoffDueOn" defaultValue={debt.payoffDueOn ?? ""} /></label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>APR %</span><input name="apr" inputMode="decimal" defaultValue={debt.aprBps === null ? "" : (debt.aprBps / 100).toString()} /></label>
              <label className="form-field"><span>Payment day of month</span><input name="dueDay" inputMode="numeric" defaultValue={debt.dueDay ?? ""} /></label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>Instalment amount</span><input name="instalmentAmount" inputMode="decimal" defaultValue={dollars(debt.instalmentAmountCents)} /></label>
              <label className="form-field"><span>How often</span>
                <select name="cadence" defaultValue={debt.cadence ?? ""}><option value="">no schedule</option>{CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}</select>
              </label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>First instalment on</span><input type="date" name="firstInstalmentOn" defaultValue={debt.firstInstalmentOn ?? ""} /></label>
              <label className="form-field"><span>Number of instalments</span><input name="instalmentCount" inputMode="numeric" defaultValue={debt.instalmentCount ?? ""} /></label>
            </div>
            <label className="form-field"><span>Every N days (custom only)</span><input name="intervalDays" inputMode="numeric" defaultValue={debt.intervalDays ?? ""} /></label>
            <label className="form-field"><span>Notes</span><input name="notes" defaultValue={debt.notes ?? ""} /></label>
            <div className="form-actions">
              <button className="button button-primary" type="submit">Save debt</button>
            </div>
          </form>
        )}
        <div className="row-actions">
          <form action={setDebtClosedAction}>
            <input type="hidden" name="id" value={debt.id} />
            <input type="hidden" name="closed" value={debt.closedAt ? "0" : "1"} />
            <button className="row-action" type="submit">{debt.closedAt ? "Reopen" : "Close this debt"}</button>
          </form>
          <form action={deleteDebtAction}>
            <input type="hidden" name="id" value={debt.id} />
            <button className="row-action" type="submit">Delete this debt and its payments</button>
          </form>
        </div>
      </section>

      {hasSchedule(debt) ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Schedule</h2>
            <p className="section-meta">{schedule.filter((s) => s.state === "paid").length} of {schedule.length} paid</p>
          </div>
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr><th scope="col" className="ledger-date">Due</th><th scope="col" className="ledger-num">Amount</th><th scope="col" className="ledger-num">Paid</th><th scope="col">State</th></tr>
              </thead>
              <tbody>
                {schedule.map((s) => (
                  <tr key={s.index}>
                    <td className="ledger-date">{s.dueOn}</td>
                    <td className="ledger-num"><Amount cents={s.amountCents} currency={debt.currency} signColour={false} /></td>
                    <td className="ledger-num"><Amount cents={s.paidCents} currency={debt.currency} signColour={false} /></td>
                    <td><StatusWord tone={s.state === "paid" ? "good" : s.state === "overdue" ? "bad" : s.state === "partial" ? "attention" : "neutral"}>{s.state}</StatusWord></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : debt.payoffDueOn ? (
        <section className="section">
          <div className="section-head"><h2 className="section-title">Payoff</h2></div>
          <p>
            <Amount cents={remaining} currency={debt.currency} signColour={false} /> must be paid by {debt.payoffDueOn}
            {debt.interestFreeUntil ? `; interest starts ${debt.interestFreeUntil}.` : "."}
          </p>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Payments</h2>
          <p className="section-meta">{payments.length === 1 ? "1 payment" : `${payments.length} payments`}</p>
        </div>
        {payments.length === 0 ? (
          <EmptyState title="No payments recorded." />
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr><th scope="col" className="ledger-date">Paid on</th><th scope="col" className="ledger-num">Amount</th><th scope="col">Source</th><th scope="col">Note</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="ledger-date">{p.paidOn}</td>
                    <td className="ledger-num"><Amount cents={p.amountCents} currency={debt.currency} signColour={false} /></td>
                    <td className="ledger-quiet">{p.transactionId ? <Link href={`/transactions?q=&from=${p.paidOn}&to=${p.paidOn}`}>bank transaction</Link> : "entered by hand"}</td>
                    <td className="ledger-quiet">{p.note ?? ""}</td>
                    <td className="row-actions">
                      <form action={deletePaymentAction}>
                        <input type="hidden" name="debtId" value={debt.id} />
                        <input type="hidden" name="paymentId" value={p.id} />
                        <button className="row-action" type="submit">Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form action={addPaymentAction} className="form">
          <input type="hidden" name="debtId" value={debt.id} />
          <div className="form-row">
            <label className="form-field"><span>Paid on</span><input type="date" name="paidOn" defaultValue={today} required /></label>
            <label className="form-field"><span>Amount</span><input name="amount" inputMode="decimal" required defaultValue={hasSchedule(debt) ? dollars(debt.instalmentAmountCents) : ""} /></label>
          </div>
          <label className="form-field"><span>Note (optional)</span><input name="note" /></label>
          <div className="form-actions"><button className="button button-primary" type="submit">Add payment</button></div>
        </form>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Link a transaction</h2>
          <p className="section-meta">recent outflows not yet set against a debt</p>
        </div>
        <form action={self} method="get" className="filters">
          <label className="filter-field filter-search"><span className="small">Search</span><input name="q" defaultValue={q} placeholder="payee or description" /></label>
          <label className="filter-field"><span className="small">Amount</span><input name="amount" inputMode="decimal" defaultValue={amountParam ?? ""} /></label>
          <div className="filter-actions"><button className="button" type="submit">Search</button></div>
        </form>
        {candidates.length === 0 ? (
          <EmptyState title="No unlinked outflows match." />
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr><th scope="col" className="ledger-date">Date</th><th scope="col">Account</th><th scope="col">Payee</th><th scope="col" className="ledger-num">Amount</th><th scope="col"><span className="sr-only">Link</span></th></tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id}>
                    <td className="ledger-date">{c.localDate ?? ""}</td>
                    <td className="ledger-quiet">{c.accountName}</td>
                    <td>{c.payee ?? c.description}</td>
                    <td className="ledger-num"><Amount cents={c.amountCents} currency={c.currency} /></td>
                    <td className="row-actions">
                      <form action={linkTransactionAction}>
                        <input type="hidden" name="debtId" value={debt.id} />
                        <input type="hidden" name="transactionId" value={c.id} />
                        <input type="hidden" name="returnTo" value={self} />
                        <button className="row-action" type="submit">Link transaction</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
