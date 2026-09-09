import { describe, it, expect, vi } from "vitest";
import { computeNextRun, startScheduler } from "@/lib/sync/scheduler";
import { makeTestDb } from "../helpers/db";
import { loadConfig } from "@/lib/config";
import { getState, setState, STATE_KEYS } from "@/lib/db/appState";
import { runSync } from "@/lib/sync/engine";

describe("computeNextRun", () => {
  it("lands on the next interval boundary plus the minute offset", () => {
    const t = Date.UTC(2026, 8, 9, 13, 5, 0); // 13:05Z
    const next = computeNextRun(t, 6, 17);
    expect(new Date(next).toISOString()).toBe("2026-09-09T18:17:00.000Z");
  });
  it("skips to the following boundary when the offset already passed", () => {
    const t = Date.UTC(2026, 8, 9, 18, 30, 0);
    expect(new Date(computeNextRun(t, 6, 17)).toISOString()).toBe("2026-09-10T00:17:00.000Z");
  });
});

describe("startScheduler", () => {
  it("returns null when interval is 0", () => {
    const db = makeTestDb();
    expect(startScheduler({ db, config: loadConfig({ SYNC_INTERVAL_HOURS: "0" }) })).toBeNull();
  });
  it("runs immediately when last success is stale, persists a minute offset, and schedules the next run", async () => {
    vi.useFakeTimers();
    const db = makeTestDb();
    const runSyncImpl = vi.fn<typeof runSync>(async () => ({ runs: [] }));
    const nowMs = Date.UTC(2026, 8, 9, 13, 5, 0);
    const handle = startScheduler({ db, config: loadConfig({ SYNC_INTERVAL_HOURS: "6", SIMPLEFIN_ACCESS_URL: "https://u:p@h/simplefin" }), runSyncImpl, now: () => nowMs, log: () => {} });
    expect(handle).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(runSyncImpl).toHaveBeenCalledTimes(1);
    expect(runSyncImpl.mock.calls[0][1]).toEqual({ trigger: "scheduled" });
    const offset = getState<number>(db, STATE_KEYS.schedulerMinuteOffset)!;
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(60);
    expect(handle!.nextRunAt()).toBe(computeNextRun(nowMs, 6, offset));
    handle!.stop();
    vi.useRealTimers();
  });
  it("does not run immediately when last success is fresh", async () => {
    vi.useFakeTimers();
    const db = makeTestDb();
    const nowMs = Date.UTC(2026, 8, 9, 13, 5, 0);
    setState(db, STATE_KEYS.lastSuccessfulSyncEnd, Math.floor(nowMs / 1000) - 3600);
    const runSyncImpl = vi.fn<typeof runSync>(async () => ({ runs: [] }));
    const handle = startScheduler({ db, config: loadConfig({ SYNC_INTERVAL_HOURS: "6" }), runSyncImpl, now: () => nowMs, log: () => {} });
    await vi.advanceTimersByTimeAsync(1);
    expect(runSyncImpl).not.toHaveBeenCalled();
    handle!.stop();
    vi.useRealTimers();
  });
  it("refuses to start twice", () => {
    const db = makeTestDb();
    const config = loadConfig({ SYNC_INTERVAL_HOURS: "6" });
    const h1 = startScheduler({ db, config, runSyncImpl: async () => ({ runs: [] }), log: () => {} });
    const h2 = startScheduler({ db, config, runSyncImpl: async () => ({ runs: [] }), log: () => {} });
    expect(h1).not.toBeNull();
    expect(h2).toBeNull();
    h1!.stop();
  });
});
