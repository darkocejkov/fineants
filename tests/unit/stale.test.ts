import { describe, it, expect } from "vitest";
import { makeTestDb } from "../helpers/db";
import { syncRuns } from "@/lib/db/schema";
import { sweepStaleRuns, STALE_RUN_SECONDS } from "@/lib/sync/stale";

const NOW = Date.UTC(2026, 8, 10, 12);

describe("sweepStaleRuns", () => {
  it("fails running rows older than the threshold and leaves fresh ones", () => {
    const db = makeTestDb();
    const old = new Date(NOW - (STALE_RUN_SECONDS + 60) * 1000).toISOString();
    const fresh = new Date(NOW - 60 * 1000).toISOString();
    db.insert(syncRuns).values([
      { trigger: "cli", status: "running", startedAt: old, windowStart: 0, windowEnd: 1 },
      { trigger: "cli", status: "running", startedAt: fresh, windowStart: 0, windowEnd: 1 },
      { trigger: "cli", status: "success", startedAt: old, finishedAt: old, windowStart: 0, windowEnd: 1 },
    ]).run();
    expect(sweepStaleRuns(db, NOW)).toBe(1);
    const rows = db.select().from(syncRuns).orderBy(syncRuns.id).all();
    expect(rows[0]).toMatchObject({ status: "failed", error: "interrupted" });
    expect(rows[0].finishedAt).toBe(new Date(NOW).toISOString());
    expect(rows[1].status).toBe("running");
    expect(rows[2].status).toBe("success");
  });
});
