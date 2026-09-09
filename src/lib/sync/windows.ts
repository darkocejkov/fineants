export type SyncWindow = { start: number; end: number };

export const DAY = 86400;
export const MAX_WINDOW_SECONDS = 90 * DAY;
export const OVERLAP_SECONDS = 5 * DAY;

export function computeWindows(lastSuccessEnd: number | null, now: number, backfillDays: number): SyncWindow[] {
  const rangeStart = lastSuccessEnd === null ? now - backfillDays * DAY : lastSuccessEnd - OVERLAP_SECONDS;
  const start0 = Math.min(rangeStart, now - OVERLAP_SECONDS);
  const windows: SyncWindow[] = [];
  let start = start0;
  while (true) {
    const end = Math.min(start + MAX_WINDOW_SECONDS, now);
    windows.push({ start, end });
    if (end >= now) break;
    start = end - OVERLAP_SECONDS;
  }
  return windows;
}
