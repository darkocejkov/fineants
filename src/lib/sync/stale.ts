import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { syncRuns } from "../db/schema";

export const STALE_RUN_SECONDS = 30 * 60;

/**
 * A run row is inserted before its HTTP request; a crash between the two leaves it `running`
 * forever, which the overview reads as "still running". Anything that old is dead.
 */
export function sweepStaleRuns(db: Db, nowMs: number): number {
  const cutoff = new Date(nowMs - STALE_RUN_SECONDS * 1000).toISOString();
  return db
    .update(syncRuns)
    .set({ status: "failed", finishedAt: new Date(nowMs).toISOString(), error: "interrupted" })
    .where(and(eq(syncRuns.status, "running"), lt(syncRuns.startedAt, cutoff)))
    .run().changes;
}
