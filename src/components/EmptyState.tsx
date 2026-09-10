import Link from "next/link";

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-guidance">{children}</div> : null}
    </div>
  );
}

/**
 * Before the first successful sync there are no accounts, and every page that would
 * otherwise blame the user's filters or date range says this instead (spec §10): the claim
 * step, where the access URL goes, and the two places to go next.
 */
export function NoAccountsEmptyState() {
  return (
    <EmptyState title="No accounts yet">
      Run <code>npm run claim</code> with your setup token, put the access URL it prints into{" "}
      <code>SIMPLEFIN_ACCESS_URL</code> in <code>.env</code>, then choose Sync now.{" "}
      <Link href="/settings">Settings</Link> shows what is configured, and the{" "}
      <Link href="/explorer">explorer</Link> shows the raw SimpleFin responses.
    </EmptyState>
  );
}
