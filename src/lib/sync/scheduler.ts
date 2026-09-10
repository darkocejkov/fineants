import type { Db } from "../db/client";
import type { Config } from "../config";
import { getState, setState, STATE_KEYS } from "../db/appState";
import { runSync } from "./engine";
import { sweepStaleRuns } from "./stale";

export type SchedulerDeps = {
  db: Db;
  config: Config;
  runSyncImpl?: typeof runSync;
  now?: () => number;
  setTimeoutImpl?: typeof setTimeout;
  log?: (msg: string) => void;
};
export type SchedulerHandle = { stop(): void; nextRunAt(): number | null };

const g = globalThis as unknown as { __fineantsScheduler?: SchedulerHandle };

export function computeNextRun(nowMs: number, intervalHours: number, minuteOffset: number): number {
  const intervalMs = intervalHours * 3600 * 1000;
  const offsetMs = minuteOffset * 60 * 1000;
  const boundary = Math.floor(nowMs / intervalMs) * intervalMs;
  let candidate = boundary + offsetMs;
  while (candidate <= nowMs) candidate += intervalMs;
  return candidate;
}

export function startScheduler(deps: SchedulerDeps): SchedulerHandle | null {
  const { db, config } = deps;
  const log = deps.log ?? ((m: string) => console.log(`[fineants scheduler] ${m}`));
  const now = deps.now ?? Date.now;
  const run = deps.runSyncImpl ?? runSync;
  const setTimeoutFn = deps.setTimeoutImpl ?? setTimeout;
  if (config.syncIntervalHours <= 0) return null;
  if (g.__fineantsScheduler) return null;

  sweepStaleRuns(db, now());

  let offset = getState<number>(db, STATE_KEYS.schedulerMinuteOffset);
  if (offset === undefined) {
    offset = Math.floor(Math.random() * 60);
    setState(db, STATE_KEYS.schedulerMinuteOffset, offset);
  }

  let timer: NodeJS.Timeout | null = null;
  let next: number | null = null;
  let stopped = false;

  const execute = async (): Promise<void> => {
    try {
      const result = await run(
        { db, accessUrl: config.simplefinAccessUrl, backfillDays: config.backfillDays, timezone: config.timezone },
        { trigger: "scheduled" },
      );
      log(result.skipped ? `skipped: ${result.skipped}` : `completed ${result.runs.length} run(s): ${result.runs.map((r) => r.status).join(",")}`);
    } catch (err) {
      log(`sync threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const scheduleNext = (): void => {
    if (stopped) return;
    next = computeNextRun(now(), config.syncIntervalHours, offset!);
    timer = setTimeoutFn(async () => {
      await execute();
      scheduleNext();
    }, next - now());
  };

  const lastEnd = getState<number>(db, STATE_KEYS.lastSuccessfulSyncEnd);
  const stale = lastEnd === undefined || now() / 1000 - lastEnd > config.syncIntervalHours * 3600;
  if (stale) {
    timer = setTimeoutFn(async () => {
      await execute();
      scheduleNext();
    }, 0);
    next = now();
  } else {
    scheduleNext();
  }
  log(`started; interval ${config.syncIntervalHours}h at :${String(offset).padStart(2, "0")}, next ${next ? new Date(next).toISOString() : "n/a"}`);

  const handle: SchedulerHandle = {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (g.__fineantsScheduler === handle) delete g.__fineantsScheduler;
    },
    nextRunAt: () => next,
  };
  g.__fineantsScheduler = handle;
  return handle;
}
