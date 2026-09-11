import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { connectionSyncState, type ConnectionSyncStateRow } from "../db/schema";

type StateDb = Pick<Db, "select" | "insert" | "update">;

export function getConnectionStates(db: StateDb): ConnectionSyncStateRow[] {
  return db.select().from(connectionSyncState).orderBy(connectionSyncState.connectionId).all();
}

/**
 * The window start every sync must reach back to.
 * `undefined`: no connection has a row yet (fall back to the global watermark).
 * `null`: some connection has never had a clean run (full backfill).
 * number: the oldest clean end across connections.
 */
export function oldestWatermark(db: StateDb): number | null | undefined {
  const rows = getConnectionStates(db);
  if (rows.length === 0) return undefined;
  let min: number | null = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    if (r.lastSuccessEnd === null) return null;
    if (r.lastSuccessEnd < min!) min = r.lastSuccessEnd;
  }
  return min;
}

export function ensureConnectionState(db: StateDb, connectionId: string, seedEnd: number | null): void {
  db.insert(connectionSyncState).values({ connectionId, lastSuccessEnd: seedEnd }).onConflictDoNothing().run();
}

/**
 * Move a watermark forward. Never backwards: a recovery backfill re-fetches old windows for the
 * connection that needs them, and a healthy connection that already reaches further must keep
 * what it has rather than be dragged back and re-fetch everything on the next run.
 */
export function advanceWatermark(db: StateDb, connectionId: string, end: number): void {
  db.update(connectionSyncState)
    .set({
      lastSuccessEnd: sql`max(coalesce(${connectionSyncState.lastSuccessEnd}, 0), ${end})`,
      lastErrorCode: null,
      lastErrorMsg: null,
      lastErrorAt: null,
    })
    .where(eq(connectionSyncState.connectionId, connectionId))
    .run();
}

export function recordConnectionError(db: StateDb, connectionId: string, code: string, msg: string, atIso: string): void {
  db.update(connectionSyncState)
    .set({ lastErrorCode: code, lastErrorMsg: msg, lastErrorAt: atIso })
    .where(eq(connectionSyncState.connectionId, connectionId))
    .run();
}
