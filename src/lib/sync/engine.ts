import { createHash } from "node:crypto";
import { and, eq, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, balanceSnapshots, connections, syncRuns, transactions } from "../db/schema";
import { deleteState, getState, setState, STATE_KEYS } from "../db/appState";
import { fetchAccounts, SimpleFinAuthError } from "../simplefin/client";
import type { AccountSet, ErrItem } from "../simplefin/types";
import { computeWindows, type SyncWindow } from "./windows";
import { toLocalDate } from "../time";
import { attributeErrors } from "./attribution";
import { sweepStaleRuns } from "./stale";
import { advanceWatermark, ensureConnectionState, oldestWatermark, recordConnectionError } from "../queries/connectionState";
import { applyTagging, type TaggingReport } from "../tagging/apply";

export type SyncTrigger = "scheduled" | "manual" | "cli";
export type SyncRunSummary = {
  runId: number;
  status: "success" | "partial" | "failed";
  windowStart: number;
  windowEnd: number;
  accountsSeen: number;
  transactionsUpserted: number;
  pendingRemoved: number;
  errlist: ErrItem[];
  error?: string;
};
export type SyncSkipReason = "credentials_invalid" | "rate_limited" | "no_access_url";
export type SyncResult = { skipped?: SyncSkipReason; runs: SyncRunSummary[]; tagging?: TaggingReport };
export type SyncDeps = {
  db: Db;
  accessUrl?: string;
  backfillDays: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timezone: string;
};
export type CredentialsInvalidState = { reason: string; accessUrlHash: string; at: string };

export const RATE_GUARD_SECONDS = 30 * 60;

export function hashAccessUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

export async function runSync(deps: SyncDeps, opts: { trigger: SyncTrigger; force?: boolean }): Promise<SyncResult> {
  const { db } = deps;
  const nowMs = (deps.now ?? Date.now)();
  const nowSec = Math.floor(nowMs / 1000);
  const force = opts.force ?? false;

  sweepStaleRuns(db, nowMs);

  if (!deps.accessUrl) return { skipped: "no_access_url", runs: [] };
  const accessUrl = deps.accessUrl;
  const urlHash = hashAccessUrl(accessUrl);

  const invalid = getState<CredentialsInvalidState>(db, STATE_KEYS.credentialsInvalid);
  if (invalid) {
    if (invalid.accessUrlHash !== urlHash) deleteState(db, STATE_KEYS.credentialsInvalid);
    else if (!force) return { skipped: "credentials_invalid", runs: [] };
  }

  const lastRun = db.select({ startedAt: syncRuns.startedAt }).from(syncRuns).orderBy(sql`${syncRuns.id} desc`).limit(1).get();
  if (!force && lastRun && nowMs - Date.parse(lastRun.startedAt) < RATE_GUARD_SECONDS * 1000) {
    return { skipped: "rate_limited", runs: [] };
  }

  const globalEnd = getState<number>(db, STATE_KEYS.lastSuccessfulSyncEnd) ?? null;
  const perConnection = oldestWatermark(db);
  const lastSuccessEnd = perConnection === undefined ? globalEnd : perConnection;
  const windows = computeWindows(lastSuccessEnd, nowSec, deps.backfillDays);
  const runs: SyncRunSummary[] = [];
  const lastWindowEnd = windows[windows.length - 1]?.end;

  // Watermarks are settled once, at the end of the run. Deciding per window would advance a
  // connection that errored in window 2 to window 3's end the moment window 3 came back clean,
  // and window 2 would never be re-fetched.
  const seenIds = new Set<string>();
  const heldAcrossRun = new Set<string>();
  const lastErrorFor = new Map<string, ConnectionError>();
  let lastGoodEnd: number | null = null;

  for (const window of windows) {
    const isLatestWindow = window.end === lastWindowEnd;
    const outcome = await syncWindow(deps, accessUrl, urlHash, window, opts.trigger, nowMs, isLatestWindow);
    runs.push(outcome.summary);
    for (const id of outcome.connectionIds) seenIds.add(id);
    for (const id of outcome.heldIds) heldAcrossRun.add(id);
    for (const [id, err] of outcome.errors) lastErrorFor.set(id, err);
    if (outcome.summary.status === "failed") break;
    lastGoodEnd = window.end;
  }

  settleWatermarks(db, { seenIds, heldAcrossRun, lastErrorFor, lastGoodEnd, at: isoFromMs(nowMs) });

  const upserted = runs.reduce((n, r) => n + r.transactionsUpserted, 0);
  if (upserted === 0) return { runs };
  try {
    const tagging = applyTagging(db, { now: deps.now });
    return { runs, tagging };
  } catch (err) {
    // The bank data is stored; a tagging defect must not read as a sync failure.
    const message = `tagging: ${err instanceof Error ? err.message : String(err)}`;
    const last = runs.at(-1);
    if (last && last.status !== "failed") {
      db.update(syncRuns).set({ status: "partial", error: message }).where(eq(syncRuns.id, last.runId)).run();
      last.status = "partial";
      last.error = message;
    }
    return { runs };
  }
}

type ConnectionError = { code: string; msg: string };
/** What one window contributes to the run's watermark decision, alongside its run summary. */
type WindowOutcome = {
  summary: SyncRunSummary;
  connectionIds: string[];
  heldIds: Set<string>;
  errors: Map<string, ConnectionError>;
};

/**
 * Advance every connection the run saw and never held, to the end of the last window that did
 * not fail; hold the rest at whatever they had, carrying the last error seen for them.
 */
function settleWatermarks(
  db: Db,
  s: { seenIds: Set<string>; heldAcrossRun: Set<string>; lastErrorFor: Map<string, ConnectionError>; lastGoodEnd: number | null; at: string },
): void {
  if (s.seenIds.size === 0) return;
  db.transaction((tx) => {
    for (const id of s.seenIds) {
      if (s.heldAcrossRun.has(id)) {
        const err = s.lastErrorFor.get(id);
        if (err) recordConnectionError(tx, id, err.code, err.msg, s.at);
      } else if (s.lastGoodEnd !== null) {
        advanceWatermark(tx, id, s.lastGoodEnd);
      }
    }
  });
}

async function syncWindow(
  deps: SyncDeps,
  accessUrl: string,
  urlHash: string,
  window: SyncWindow,
  trigger: SyncTrigger,
  nowMs: number,
  isLatestWindow: boolean,
): Promise<WindowOutcome> {
  const { db } = deps;
  const stamp = isoFromMs(nowMs);
  const run = db
    .insert(syncRuns)
    .values({ trigger, status: "running", startedAt: stamp, windowStart: window.start, windowEnd: window.end })
    .returning({ id: syncRuns.id })
    .get();

  const base = { runId: run.id, windowStart: window.start, windowEnd: window.end, accountsSeen: 0, transactionsUpserted: 0, pendingRemoved: 0, errlist: [] as ErrItem[] };
  // A window that never wrote anything contributes nothing to the run's watermark decision.
  const noOutcome = { connectionIds: [] as string[], heldIds: new Set<string>(), errors: new Map<string, ConnectionError>() };

  let accountSet: AccountSet;
  let rawBody: string | undefined;
  let httpStatus: number | undefined;
  try {
    const res = await fetchAccounts(accessUrl, { start: window.start, end: window.end, pending: true, fetchImpl: deps.fetchImpl });
    accountSet = res.accountSet;
    rawBody = res.rawBody;
    httpStatus = res.httpStatus;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof SimpleFinAuthError) {
      setState(db, STATE_KEYS.credentialsInvalid, { reason: message, accessUrlHash: urlHash, at: stamp } satisfies CredentialsInvalidState);
    }
    const errInfo = err as { rawBody?: string; body?: string; status?: number };
    const raw = errInfo.rawBody ?? errInfo.body;
    db.update(syncRuns)
      .set({ status: "failed", finishedAt: stamp, error: message, rawResponse: raw, httpStatus: errInfo.status })
      .where(eq(syncRuns.id, run.id))
      .run();
    return { summary: { ...base, status: "failed", error: message }, ...noOutcome };
  }

  const attribution = attributeErrors(accountSet.errlist, accountSet.connections);
  const errors = new Map<string, ConnectionError>();
  for (const id of attribution.heldIds) {
    // An error pinned on this connection, else the unattributed one that holds everybody.
    const err = attribution.items.find((e) => e.attributedConnectionId === id) ?? attribution.items.find((e) => !e.attributedConnectionId)!;
    errors.set(id, { code: err.code, msg: err.msg });
  }

  // The run row was inserted before the fetch, outside this transaction, so a throw in here
  // rolls back the writes but leaves the row `running` — which reads as "still running" on the
  // overview forever and wedges the rate guard, since the guard takes the newest run whatever
  // its status. Marking it `failed` has to happen after the rollback, on `db` rather than `tx`.
  try {
    const result = db.transaction((tx) => {
      for (const c of accountSet.connections) {
        tx.insert(connections)
          .values({ id: c.id, name: c.name, domain: c.domain, url: c.url, sfinUrl: c.sfinUrl, raw: JSON.stringify(c.raw), firstSeenAt: stamp, lastSeenAt: stamp })
          .onConflictDoUpdate({ target: connections.id, set: { name: c.name, domain: c.domain, url: c.url, sfinUrl: c.sfinUrl, raw: JSON.stringify(c.raw), lastSeenAt: stamp } })
          .run();
      }

      let upserted = 0;
      let removed = 0;
      for (const a of accountSet.accounts) {
        tx.insert(accounts)
          .values({ id: a.id, connectionId: a.connectionId, name: a.name, currency: a.currency, balanceCents: a.balanceCents, availableBalanceCents: a.availableBalanceCents ?? null, balanceDate: a.balanceDate, raw: JSON.stringify(a.raw), firstSeenAt: stamp, lastSeenAt: stamp })
          .onConflictDoUpdate({ target: accounts.id, set: { connectionId: a.connectionId, name: a.name, currency: a.currency, balanceCents: a.balanceCents, availableBalanceCents: a.availableBalanceCents ?? null, balanceDate: a.balanceDate, raw: JSON.stringify(a.raw), lastSeenAt: stamp } })
          .run();

        for (const t of a.transactions) {
          const effectiveSec = t.posted !== 0 ? t.posted : (t.transactedAt ?? Math.floor(nowMs / 1000));
          const localDate = toLocalDate(effectiveSec, deps.timezone);
          tx.insert(transactions)
            .values({ id: t.id, accountId: a.id, posted: t.posted, transactedAt: t.transactedAt ?? null, amountCents: t.amountCents, description: t.description, payee: t.payee ?? null, memo: t.memo ?? null, pending: t.pending, raw: JSON.stringify(t.raw), firstSeenAt: stamp, lastSeenAt: stamp, localDate })
            .onConflictDoUpdate({ target: transactions.id, set: { accountId: a.id, posted: t.posted, transactedAt: t.transactedAt ?? null, amountCents: t.amountCents, description: t.description, payee: t.payee ?? null, memo: t.memo ?? null, pending: t.pending, raw: JSON.stringify(t.raw), lastSeenAt: stamp, localDate } })
            .run();
          upserted++;
        }

        const seenIds = a.transactions.map((t) => t.id);
        // A pending transaction's "effective" date is its transacted_at if known, else its
        // posted date (posted === 0 means "no date yet", so nullif turns that into NULL too).
        const effective = sql`coalesce(${transactions.transactedAt}, nullif(${transactions.posted}, 0))`;
        const reconcileWindow = isLatestWindow
          ? sql`((${effective} is not null and ${effective} >= ${window.start} and ${effective} < ${window.end}) or ${effective} is null)`
          : sql`(${effective} is not null and ${effective} >= ${window.start} and ${effective} < ${window.end})`;
        const where = seenIds.length
          ? and(eq(transactions.accountId, a.id), eq(transactions.pending, true), notInArray(transactions.id, seenIds), reconcileWindow)
          : and(eq(transactions.accountId, a.id), eq(transactions.pending, true), reconcileWindow);
        removed += tx.delete(transactions).where(where).run().changes;

        tx.insert(balanceSnapshots)
          .values({ accountId: a.id, syncRunId: run.id, balanceCents: a.balanceCents, availableBalanceCents: a.availableBalanceCents ?? null, balanceDate: a.balanceDate, recordedAt: stamp })
          .run();
      }

      const status = accountSet.errlist.length ? "partial" : "success";
      tx.update(syncRuns)
        .set({ status, finishedAt: stamp, httpStatus, accountsSeen: accountSet.accounts.length, transactionsUpserted: upserted, pendingRemoved: removed, errlist: JSON.stringify(attribution.items), rawResponse: rawBody })
        .where(eq(syncRuns.id, run.id))
        .run();

      // New connections are seeded from the global watermark rather than forced into a full
      // backfill. Whether each one advances is decided once the whole run is done, in
      // settleWatermarks — an error in any window has to hold the connection past the windows
      // that came back clean after it.
      const seed = getState<number>(tx, STATE_KEYS.lastSuccessfulSyncEnd) ?? null;
      for (const c of accountSet.connections) ensureConnectionState(tx, c.id, seed);
      setState(tx, STATE_KEYS.lastSuccessfulSyncEnd, window.end);
      // The fetch succeeded, so whatever credentials we used are good — clear any stale flag.
      deleteState(tx, STATE_KEYS.credentialsInvalid);
      return { status, upserted, removed, errlist: attribution.items } as const;
    });

    return {
      summary: { ...base, status: result.status, accountsSeen: accountSet.accounts.length, transactionsUpserted: result.upserted, pendingRemoved: result.removed, errlist: result.errlist },
      connectionIds: accountSet.connections.map((c) => c.id),
      heldIds: attribution.heldIds,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(syncRuns).set({ status: "failed", finishedAt: stamp, error: message }).where(eq(syncRuns.id, run.id)).run();
    return { summary: { ...base, status: "failed", error: message }, ...noOutcome };
  }
}
