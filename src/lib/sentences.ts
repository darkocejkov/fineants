import { formatCents } from "./money";

export type ChangePoint = { date: string; balanceCents: number };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const DAY_MS = 86400000;

const dayStart = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`);

/**
 * Names the sync a snapshot came from. A weekday reads faster than a date, but only stays
 * unambiguous for a week, so anything older is named by its date instead.
 */
export function whenSynced(date: string, nowMs = Date.now()): string {
  const from = dayStart(date);
  if (!Number.isFinite(from)) return `the ${date} sync`;
  const days = Math.round((dayStart(new Date(nowMs).toISOString()) - from) / DAY_MS);
  if (days >= 0 && days <= 6) return `${WEEKDAYS[new Date(from).getUTCDay()]}'s sync`;
  return `the ${date.slice(0, 10)} sync`;
}

/** The change since the previous snapshot, read off the last two points of a currency's series. */
export function changeSentence(points: ChangePoint[], currency: string, nowMs = Date.now()): string {
  if (points.length < 2) return "No earlier snapshot to compare yet.";
  const previous = points[points.length - 2];
  const latest = points[points.length - 1];
  const delta = latest.balanceCents - previous.balanceCents;
  const when = whenSynced(previous.date, nowMs);
  if (delta === 0) return `Unchanged since ${when}.`;
  return `${delta > 0 ? "Up" : "Down"} ${formatCents(Math.abs(delta), currency)} since ${when}.`;
}
