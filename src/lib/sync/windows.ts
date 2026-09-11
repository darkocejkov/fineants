export type SyncWindow = { start: number; end: number };

export const DAY = 86400;
export const MAX_WINDOW_SECONDS = 90 * DAY;
export const OVERLAP_SECONDS = 5 * DAY;

export function computeWindows(lastSuccessEnd: number | null, now: number, backfillDays: number): SyncWindow[] {
  // A watermark held for months would otherwise grow the request count without limit, so the
  // range never reaches further back than the backfill horizon a first sync would ask for.
  const horizon = now - backfillDays * DAY;
  const rangeStart = lastSuccessEnd === null ? horizon : Math.max(lastSuccessEnd - OVERLAP_SECONDS, horizon);
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
