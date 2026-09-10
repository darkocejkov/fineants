import { eq, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { connections, connectionSyncState, transactions } from "./schema";
import { getState, setState, STATE_KEYS } from "./appState";
import { toLocalDate } from "../time";
import { seedDefaultCategories } from "../queries/categories";
import { ensureConnectionState } from "../queries/connectionState";
import { applyTagging } from "../tagging/apply";
import { effectiveDate } from "../queries/transactions";

export const BOOTSTRAP_VERSION = 1;

export type BootstrapReport = {
  localDatesBackfilled: number;
  categoriesSeeded: number;
  connectionsSeeded: number;
  timezoneRecomputed: boolean;
  version: number;
};

function writeLocalDates(db: Db, tz: string, onlyNull: boolean): number {
  const q = db.select({ id: transactions.id, sec: effectiveDate }).from(transactions);
  const rows = onlyNull ? q.where(isNull(transactions.localDate)).all() : q.all();
  db.transaction((tx) => {
    for (const r of rows) tx.update(transactions).set({ localDate: toLocalDate(r.sec, tz) }).where(eq(transactions.id, r.id)).run();
  });
  return rows.length;
}

/**
 * Data migrations that SQL alone cannot express, run after the schema migration. Each step is
 * idempotent; the version gate just keeps a healthy boot from re-scanning tables for nothing.
 */
export function runDataSteps(db: Db, opts: { timezone: string; now?: () => number }): BootstrapReport {
  const nowIso = new Date((opts.now ?? Date.now)()).toISOString();
  const report: BootstrapReport = { localDatesBackfilled: 0, categoriesSeeded: 0, connectionsSeeded: 0, timezoneRecomputed: false, version: BOOTSTRAP_VERSION };
  const storedTz = getState<string>(db, STATE_KEYS.timezone);
  const version = getState<number>(db, STATE_KEYS.bootstrapVersion) ?? 0;

  if (version < 1) {
    report.categoriesSeeded = seedDefaultCategories(db, nowIso);
    const seedEnd = getState<number>(db, STATE_KEYS.lastSuccessfulSyncEnd) ?? null;
    const known = new Set(db.select({ id: connectionSyncState.connectionId }).from(connectionSyncState).all().map((r) => r.id));
    for (const c of db.select({ id: connections.id }).from(connections).all()) {
      if (known.has(c.id)) continue;
      ensureConnectionState(db, c.id, seedEnd);
      report.connectionsSeeded++;
    }
    setState(db, STATE_KEYS.bootstrapVersion, 1);
  }

  if (storedTz !== undefined && storedTz !== opts.timezone) {
    report.localDatesBackfilled = writeLocalDates(db, opts.timezone, false);
    report.timezoneRecomputed = true;
    setState(db, STATE_KEYS.timezone, opts.timezone);
    applyTagging(db, { now: opts.now });
  } else {
    report.localDatesBackfilled = writeLocalDates(db, opts.timezone, true);
    if (storedTz === undefined) setState(db, STATE_KEYS.timezone, opts.timezone);
  }
  return report;
}
