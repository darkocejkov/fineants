import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { loadConfig } from "@/lib/config";
import { first, type SearchParams } from "@/lib/searchParams";
import { accounts, transactions } from "@/lib/db/schema";
import { listDebtsWithStatus } from "@/lib/queries/debts";
import { todayLocal } from "@/lib/time";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { linkTransactionAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LinkPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const txId = first(sp.tx);
  if (!txId) notFound();
  const db = getDb();
  const tx = db
    .select({ id: transactions.id, localDate: transactions.localDate, payee: transactions.payee, description: transactions.description, amountCents: transactions.amountCents, currency: accounts.currency })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(eq(transactions.id, txId))
    .get();
  if (!tx) notFound();
  const today = todayLocal(loadConfig().timezone);
  const debts = listDebtsWithStatus(db, { today }).filter((d) => d.status !== "paid_off");
  const returnTo = first(sp.returnTo) && /^\/(?![/\\])/.test(first(sp.returnTo)!) ? first(sp.returnTo)! : "/transactions";
  const error = first(sp.error);

  return (
    <>
      <section className="section section-lead">
        <p className="small"><Link href={returnTo}>Back</Link></p>
        <h1 className="section-title">Set against a debt</h1>
        <dl className="facts">
          <dt>Transaction</dt><dd>{tx.payee ?? tx.description}</dd>
          <dt>Date</dt><dd>{tx.localDate ?? ""}</dd>
          <dt>Amount</dt><dd><Amount cents={tx.amountCents} currency={tx.currency} /></dd>
        </dl>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Open debts</h2>
          <p className="section-meta">the payment date and amount are taken from the transaction</p>
        </div>
        {debts.length === 0 ? (
          <EmptyState title="No open debts."><Link href="/debts">Add one first.</Link></EmptyState>
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <tbody>
                {debts.map((d) => (
                  <tr key={d.id}>
                    <td><Link href={`/debts/${d.id}`}>{d.name}</Link> <span className="ledger-quiet">{d.lender}</span></td>
                    <td className="ledger-num"><Amount cents={d.remainingCents} currency={d.currency} signColour={false} /> <span className="small">remaining</span></td>
                    <td className="row-actions">
                      <form action={linkTransactionAction}>
                        <input type="hidden" name="debtId" value={d.id} />
                        <input type="hidden" name="transactionId" value={tx.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="row-action" type="submit">Link to {d.name}</button>
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
