import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { first, type SearchParams } from "@/lib/searchParams";
import { listAccounts } from "@/lib/queries/accounts";
import { getConnectionStates } from "@/lib/queries/connectionState";
import { getLastTagging } from "@/lib/tagging/apply";
import { ACCOUNT_TYPES, connections } from "@/lib/db/schema";
import { loadConfig } from "@/lib/config";
import { getState, STATE_KEYS } from "@/lib/db/appState";
import { unixToDate, isoToLocal, relativeFromNow } from "@/lib/format";
import { SettingsNav } from "@/components/SettingsNav";
import { StatusWord } from "@/components/StatusWord";
import { EmptyState } from "@/components/EmptyState";
import { updateAccount, rerunTaggingAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const saved = first(sp.saved);
  const tagged = first(sp.tagged) === "1";
  const db = getDb();
  const config = loadConfig();
  const accounts = listAccounts(db, { includeHidden: true });
  const offset = getState<number>(db, STATE_KEYS.schedulerMinuteOffset) ?? 0;
  const states = getConnectionStates(db);
  const names = new Map(db.select({ id: connections.id, name: connections.name }).from(connections).all().map((c) => [c.id, c.name]));
  const last = getLastTagging(db);

  return (
    <>
      <section className="section section-lead">
        <div className="section-head">
          <h1 className="section-title">Sync</h1>
        </div>
        <SettingsNav current="general" />
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
          <dt>Timezone</dt>
          <dd>{config.timezone}</dd>
        </dl>
        <p className="hero-note">
          Change these in <code>.env</code> and restart the server.
        </p>
        <p className="hero-note">
          Changing TIMEZONE in .env recomputes every transaction&apos;s day on the next start.
        </p>
        <p className="hero-note">
          Other consumers, such as Magic Frame, call <code>GET /api/v1/summary</code>,{" "}
          <code>GET /api/v1/spending?range=7d</code>, and <code>POST /api/tag</code>, authenticated with the{" "}
          <code>x-api-key</code> header.
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Connections</h2>
          <p className="section-meta">what each bank has synced up to</p>
        </div>
        {states.length === 0 ? (
          <EmptyState title="No connections yet.">Sync first.</EmptyState>
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Bank</th>
                  <th scope="col" className="ledger-date">Synced up to</th>
                  <th scope="col">Last error</th>
                </tr>
              </thead>
              <tbody>
                {states.map((s) => (
                  <tr key={s.connectionId}>
                    <td>{names.get(s.connectionId) ?? s.connectionId}</td>
                    <td className="ledger-date">{s.lastSuccessEnd ? unixToDate(s.lastSuccessEnd) : "never"}</td>
                    <td>
                      {s.lastErrorCode ? (
                        <>
                          <StatusWord tone="attention">held</StatusWord> {s.lastErrorMsg} <span className="small">({isoToLocal(s.lastErrorAt)})</span>
                        </>
                      ) : (
                        <StatusWord tone="good">clear</StatusWord>
                      )}
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
          <h2 className="section-title">Tagging</h2>
          {last ? <p className="section-meta">last run {relativeFromNow(last.at)}</p> : null}
        </div>
        <p>
          {last
            ? `Categorised ${last.categorised}, cleared ${last.categoryCleared}, paired ${last.transfersPaired} transfers, in ${last.durationMs} ms.`
            : "Rules have not been applied yet."}
          {tagged ? " Done." : ""}
        </p>
        {last && last.invalidRules.length > 0 ? (
          <p className="form-error">
            {last.invalidRules.length === 1 ? "One rule" : `${last.invalidRules.length} rules`} could not be compiled and were skipped. Fix them under{" "}
            <Link href="/settings/rules">Rules</Link>.
          </p>
        ) : null}
        <form action={rerunTaggingAction}>
          <button className="button" type="submit">Re-run tagging</button>
        </form>
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
