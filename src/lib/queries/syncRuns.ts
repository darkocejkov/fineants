import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { syncRuns, type SyncRunRow } from "../db/schema";
import { getState, STATE_KEYS } from "../db/appState";
import type { CredentialsInvalidState } from "../sync/engine";
import type { ErrItem } from "../simplefin/types";

export type SyncStatus = {
  latest: SyncRunRow | undefined;
  lastSuccessfulSyncEnd: number | undefined;
  credentialsInvalid: CredentialsInvalidState | undefined;
  latestErrlist: ErrItem[];
};

export function listSyncRuns(db: Db, limit = 50): SyncRunRow[] {
  return db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(limit).all();
}

export function getSyncRun(db: Db, id: number): SyncRunRow | undefined {
  return db.select().from(syncRuns).where(eq(syncRuns.id, id)).get();
}

export function getSyncStatus(db: Db): SyncStatus {
  const latest = listSyncRuns(db, 1)[0];
  return {
    latest,
    lastSuccessfulSyncEnd: getState<number>(db, STATE_KEYS.lastSuccessfulSyncEnd),
    credentialsInvalid: getState<CredentialsInvalidState>(db, STATE_KEYS.credentialsInvalid),
    latestErrlist: latest ? (JSON.parse(latest.errlist) as ErrItem[]) : [],
  };
}
