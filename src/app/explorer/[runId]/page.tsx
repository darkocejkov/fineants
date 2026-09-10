import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getSyncRun } from "@/lib/queries/syncRuns";
import { isoToLocal, unixToDate } from "@/lib/format";
import { JsonView } from "@/components/JsonView";
import type { ErrItem } from "@/lib/simplefin/types";

export const dynamic = "force-dynamic";

// The raw body is shown as it came over the wire, not through the app's normalised
// AccountSet, so a response that fails validation can still be inspected here.
type RawAccount = { id?: string; name?: string; transactions?: unknown[] } & Record<string, unknown>;

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!/^\d+$/.test(runId)) notFound();
  const id = Number(runId);
  if (!Number.isInteger(id)) notFound();
  const run = getSyncRun(getDb(), id);
  if (!run) notFound();
  const errs = JSON.parse(run.errlist) as ErrItem[];

  let parsed: Record<string, unknown> | null = null;
  let accounts: RawAccount[] = [];
  if (run.rawResponse) {
    try {
      parsed = JSON.parse(run.rawResponse) as Record<string, unknown>;
      accounts = Array.isArray(parsed.accounts) ? (parsed.accounts as RawAccount[]) : [];
    } catch {
      parsed = null;
    }
  }
  const topLevel = parsed ? Object.fromEntries(Object.entries(parsed).filter(([k]) => k !== "accounts")) : null;

  return (
    <>
      <section className="section section-lead">
        <p className="small">
          <Link href="/explorer">All runs</Link>
        </p>
        <h1 className="section-title">Sync run {run.id}</h1>
        <dl className="facts">
          <dt>Status</dt>
          <dd>{run.status}</dd>
          <dt>Trigger</dt>
          <dd>{run.trigger}</dd>
          <dt>Started</dt>
          <dd>{isoToLocal(run.startedAt)}</dd>
          <dt>Finished</dt>
          <dd>{isoToLocal(run.finishedAt)}</dd>
          <dt>Window</dt>
          <dd>
            {unixToDate(run.windowStart)} to {unixToDate(run.windowEnd)}
          </dd>
          <dt>HTTP status</dt>
          <dd>{run.httpStatus ?? "—"}</dd>
          <dt>Accounts seen</dt>
          <dd>{run.accountsSeen}</dd>
          <dt>Transactions upserted</dt>
          <dd>{run.transactionsUpserted}</dd>
          <dt>Pending removed</dt>
          <dd>{run.pendingRemoved}</dd>
        </dl>
      </section>

      {run.error ? (
        <section className="section section-alert">
          <div className="section-head">
            <h2 className="section-title">Error</h2>
          </div>
          <p>{run.error}</p>
        </section>
      ) : null}

      {errs.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">SimpleFin errlist</h2>
            <p className="section-meta">
              {errs.length} {errs.length === 1 ? "item" : "items"}
            </p>
          </div>
          <JsonView value={errs} />
        </section>
      ) : null}

      {topLevel ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Response, without accounts</h2>
          </div>
          <JsonView value={topLevel} />
        </section>
      ) : null}

      {accounts.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Accounts</h2>
            <p className="section-meta">
              {accounts.length} in this response
            </p>
          </div>
          {accounts.map((a, i) => {
            const allTx = Array.isArray(a.transactions) ? a.transactions : [];
            const txCount = allTx.length;
            const shownTx = allTx.length > 200 ? allTx.slice(0, 200) : allTx;
            return (
              <details key={String(a.id ?? i)} className="disclosure">
                <summary className="disclosure-summary">
                  {String(a.name ?? a.id ?? `Account ${i + 1}`)}, {txCount} {txCount === 1 ? "transaction" : "transactions"}
                </summary>
                <div className="disclosure-body">
                  <div>
                    <p className="small">Account fields</p>
                    <JsonView value={Object.fromEntries(Object.entries(a).filter(([k]) => k !== "transactions"))} />
                  </div>
                  <details>
                    <summary className="disclosure-summary">Transactions</summary>
                    {txCount > 200 ? (
                      <p className="small">Showing 200 of {txCount} transactions. The full response is stored in the database.</p>
                    ) : null}
                    <JsonView value={shownTx} />
                  </details>
                </div>
              </details>
            );
          })}
        </section>
      ) : null}

      {!parsed && run.rawResponse ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Raw body</h2>
            <p className="section-meta">not JSON</p>
          </div>
          <pre className="json">{run.rawResponse.slice(0, 20000)}</pre>
        </section>
      ) : null}
    </>
  );
}
