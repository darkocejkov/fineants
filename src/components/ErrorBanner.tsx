import Link from "next/link";
import type { SyncStatus } from "@/lib/queries/syncRuns";

export function ErrorBanner({ status }: { status: SyncStatus }) {
  const items: React.ReactNode[] = [];
  if (status.credentialsInvalid) {
    items.push(
      <li key="cred">
        SimpleFin rejected the access URL with HTTP 403, so scheduled syncs are paused until <code>SIMPLEFIN_ACCESS_URL</code>{" "}
        changes. {status.credentialsInvalid.reason}
      </li>,
    );
  }
  if (status.latest?.status === "failed" && status.latest.error) {
    items.push(<li key="failed">The last sync failed: {status.latest.error}</li>);
  }
  for (const e of status.latestErrlist) {
    items.push(
      <li key={`${e.code}-${e.connId ?? ""}-${e.msg}`}>
        <code>{e.code}</code> {e.msg}
        {e.connId ? ` (connection ${e.connId})` : ""}
      </li>,
    );
  }
  if (items.length === 0) return null;
  return (
    <section className="section section-alert">
      <div className="section-head">
        <h2 className="section-title">SimpleFin reported problems</h2>
        <p className="section-meta">
          {items.length} {items.length === 1 ? "problem" : "problems"}
        </p>
      </div>
      <ul className="alert-list">{items}</ul>
      <p className="alert-advice">
        The <Link href="/explorer">explorer</Link> holds the raw responses. A connection error usually means the bank needs
        re-authenticating at SimpleFin Bridge.
      </p>
    </section>
  );
}
