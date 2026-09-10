import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/queries/accounts";
import { ACCOUNT_TYPES } from "@/lib/db/schema";
import { loadConfig } from "@/lib/config";
import { getState, STATE_KEYS } from "@/lib/db/appState";
import { EmptyState } from "@/components/EmptyState";
import { updateAccount } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const saved = one(sp.saved);
  const db = getDb();
  const config = loadConfig();
  const accounts = listAccounts(db, { includeHidden: true });
  const offset = getState<number>(db, STATE_KEYS.schedulerMinuteOffset) ?? 0;

  return (
    <>
      <section className="section section-lead">
        <div className="section-head">
          <h1 className="section-title">Sync</h1>
        </div>
        <dl className="facts">
          <dt>Access URL</dt>
          <dd>{config.simplefinAccessUrl ? "configured" : "not set"}</dd>
          <dt>Schedule</dt>
          <dd>
            {config.syncIntervalHours > 0
              ? `every ${config.syncIntervalHours} h at :${String(offset).padStart(2, "0")}`
              : "disabled"}
          </dd>
          <dt>Backfill</dt>
          <dd>{config.backfillDays} days</dd>
          <dt>API key</dt>
          <dd>{config.apiKey ? "configured" : "not set"}</dd>
          <dt>Database</dt>
          <dd>{config.databasePath}</dd>
        </dl>
        <p className="hero-note">
          Change these in <code>.env</code> and restart the server.
        </p>
        <p className="hero-note">
          Other consumers, such as Magic Frame, call <code>GET /api/v1/summary</code> and{" "}
          <code>GET /api/v1/spending?range=7d</code>, authenticated with the <code>x-api-key</code> header.
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Accounts</h2>
          {accounts.length > 0 ? (
            <p className="section-meta">{accounts.length === 1 ? "1 account" : `${accounts.length} accounts`}</p>
          ) : null}
        </div>
        {accounts.length === 0 ? (
          <EmptyState title="No accounts yet.">
            <Link href="/explorer">Sync first.</Link>
          </EmptyState>
        ) : (
          accounts.map((a) => (
            <form key={a.id} action={updateAccount} className="filters account-row">
              <input type="hidden" name="id" value={a.id} />
              <div>
                <p>
                  {a.name}
                  {a.hidden ? <span className="small"> hidden</span> : null}
                </p>
                <p className="small">id {a.id}</p>
              </div>
              <label className="filter-field">
                <span className="small">Nickname</span>
                <input name="nickname" defaultValue={a.nickname ?? ""} placeholder={a.name} />
              </label>
              <label className="filter-field">
                <span className="small">Type</span>
                <select name="type" defaultValue={a.type ?? ""}>
                  <option value="">unclassified</option>
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span className="small">Hidden</span>
                <input type="checkbox" name="hidden" defaultChecked={a.hidden} />
              </label>
              <div className="filter-actions">
                <button className="button button-primary" type="submit">
                  Save
                </button>
                {saved === a.id ? <span className="small">Saved</span> : null}
              </div>
            </form>
          ))
        )}
      </section>
    </>
  );
}
