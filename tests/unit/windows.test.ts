import { describe, it, expect } from "vitest";
import { computeWindows, DAY, MAX_WINDOW_SECONDS, OVERLAP_SECONDS } from "@/lib/sync/windows";

const NOW = 1_757_400_000;

describe("computeWindows", () => {
  it("backfills in <=90 day chunks with 5 day overlap, oldest first, ending at now", () => {
    const w = computeWindows(null, NOW, 365);
    expect(w[0].start).toBe(NOW - 365 * DAY);
    expect(w.at(-1)!.end).toBe(NOW);
    for (const win of w) expect(win.end - win.start).toBeLessThanOrEqual(MAX_WINDOW_SECONDS);
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBe(w[i - 1].end - OVERLAP_SECONDS);
    expect(w.length).toBe(5);
  });
  it("returns one window when backfill fits in 90 days", () => {
    expect(computeWindows(null, NOW, 30)).toEqual([{ start: NOW - 30 * DAY, end: NOW }]);
  });
  it("incremental sync starts 5 days before last success", () => {
    const last = NOW - 6 * 3600;
    expect(computeWindows(last, NOW, 365)).toEqual([{ start: last - OVERLAP_SECONDS, end: NOW }]);
  });
  it("splits a long gap into chunks", () => {
    const last = NOW - 200 * DAY;
    const w = computeWindows(last, NOW, 365);
    expect(w[0].start).toBe(last - OVERLAP_SECONDS);
    expect(w.at(-1)!.end).toBe(NOW);
    expect(w.length).toBe(3);
  });
  it("handles exactly 90 days", () => {
    const w = computeWindows(null, NOW, 90);
    expect(w).toEqual([{ start: NOW - 90 * DAY, end: NOW }]);
  });
  it("clamps a frozen watermark to the backfill horizon", () => {
    // A connection held for 400 days must not grow the request count without limit: the range
    // start is bounded by the backfill horizon, so it asks for exactly what a first sync asks for.
    const frozen = NOW - 400 * DAY;
    expect(computeWindows(frozen, NOW, 365)).toEqual(computeWindows(null, NOW, 365));
  });
  it("leaves a watermark inside the backfill horizon alone", () => {
    const last = NOW - 10 * DAY;
    expect(computeWindows(last, NOW, 365)).toEqual([{ start: last - OVERLAP_SECONDS, end: NOW }]);
  });
  it("never returns an empty or inverted window", () => {
    const w = computeWindows(NOW, NOW, 365);
    expect(w).toEqual([{ start: NOW - OVERLAP_SECONDS, end: NOW }]);
    expect(computeWindows(null, NOW, 0)).toEqual([{ start: NOW - OVERLAP_SECONDS, end: NOW }]);
  });
});
