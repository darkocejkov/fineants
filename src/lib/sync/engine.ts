import { createHash } from "node:crypto";
import { and, eq, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { nowIso } from "../db/client";
import { accounts, balanceSnapshots, connections, syncRuns, transactions } from "../db/schema";
import { deleteState, getState, setState, STATE_KEYS } from "../db/appState";
import { fetchAccounts, SimpleFinAuthError } from "../simplefin/client";
import type { AccountSet, ErrItem } from "../simplefin/types";
import { computeWindows, type SyncWindow } from "./windows";

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
export type SyncResult = { skipped?: SyncSkipReason; runs: SyncRunSummary[] };
export type SyncDeps = {
  db: Db;
  accessUrl?: string;
  backfillDays: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
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

  const lastSuccessEnd = getState<number>(db, STATE_KEYS.lastSuccessfulSyncEnd) ?? null;
  const windows = computeWindows(lastSuccessEnd, nowSec, deps.backfillDays);
  const runs: SyncRunSummary[] = [];

  for (const window of windows) {
    const summary = await syncWindow(deps, accessUrl, urlHash, window, opts.trigger, nowMs);
    runs.push(summary);
    if (summary.status === "failed") break;
  }
  return { runs };
}

async function syncWindow(deps: SyncDeps, accessUrl: string, urlHash: string, window: SyncWindow, trigger: SyncTrigger, nowMs: number): Promise<SyncRunSummary> {
  const { db } = deps;
  const startedAt = isoFromMs(nowMs);
  const run = db
    .insert(syncRuns)
    .values({ trigger, status: "running", startedAt, windowStart: window.start, windowEnd: window.end })
    .returning({ id: syncRuns.id })
    .get();

  const base = { runId: run.id, windowStart: window.start, windowEnd: window.end, accountsSeen: 0, transactionsUpserted: 0, pendingRemoved: 0, errlist: [] as ErrItem[] };

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
      setState(db, STATE_KEYS.credentialsInvalid, { reason: message, accessUrlHash: urlHash, at: nowIso() } satisfies CredentialsInvalidState);
    }
    const raw = (err as { rawBody?: string }).rawBody;
    db.update(syncRuns)
      .set({ status: "failed", finishedAt: nowIso(), error: message, rawResponse: raw, httpStatus: (err as { status?: number }).status })
      .where(eq(syncRuns.id, run.id))
      .run();
    return { ...base, status: "failed", error: message };
  }

  const stamp = nowIso();
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
        tx.insert(transactions)
          .values({ id: t.id, accountId: a.id, posted: t.posted, transactedAt: t.transactedAt ?? null, amountCents: t.amountCents, description: t.description, payee: t.payee ?? null, memo: t.memo ?? null, pending: t.pending, raw: JSON.stringify(t.raw), firstSeenAt: stamp, lastSeenAt: stamp })
          .onConflictDoUpdate({ target: transactions.id, set: { accountId: a.id, posted: t.posted, transactedAt: t.transactedAt ?? null, amountCents: t.amountCents, description: t.description, payee: t.payee ?? null, memo: t.memo ?? null, pending: t.pending, raw: JSON.stringify(t.raw), lastSeenAt: stamp } })
          .run();
        upserted++;
      }

      const seenIds = a.transactions.map((t) => t.id);
      const windowStartIso = new Date(window.start * 1000).toISOString();
      const inWindow = sql`((${transactions.transactedAt} is not null and ${transactions.transactedAt} >= ${window.start} and ${transactions.transactedAt} < ${window.end}) or (${transactions.transactedAt} is null and ${transactions.firstSeenAt} >= ${windowStartIso}))`;
      const where = seenIds.length
        ? and(eq(transactions.accountId, a.id), eq(transactions.pending, true), notInArray(transactions.id, seenIds), inWindow)
        : and(eq(transactions.accountId, a.id), eq(transactions.pending, true), inWindow);
      removed += tx.delete(transactions).where(where).run().changes;

      tx.insert(balanceSnapshots)
        .values({ accountId: a.id, syncRunId: run.id, balanceCents: a.balanceCents, availableBalanceCents: a.availableBalanceCents ?? null, balanceDate: a.balanceDate, recordedAt: stamp })
        .run();
    }

    const status = accountSet.errlist.length ? "partial" : "success";
    tx.update(syncRuns)
      .set({ status, finishedAt: stamp, httpStatus, accountsSeen: accountSet.accounts.length, transactionsUpserted: upserted, pendingRemoved: removed, errlist: JSON.stringify(accountSet.errlist), rawResponse: rawBody })
      .where(eq(syncRuns.id, run.id))
      .run();
    setState(tx as unknown as Db, STATE_KEYS.lastSuccessfulSyncEnd, window.end);
    return { status, upserted, removed } as const;
  });

  return { ...base, status: result.status, accountsSeen: accountSet.accounts.length, transactionsUpserted: result.upserted, pendingRemoved: result.removed, errlist: accountSet.errlist };
}
