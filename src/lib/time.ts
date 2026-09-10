/**
 * Calendar arithmetic for the app timezone.
 *
 * SQLite knows nothing about DST, so fineants renders every transaction's effective instant to a
 * `local_date` string once, at write time, and groups by that. Everything here is plain
 * TypeScript on Intl; no library.
 */
export const DEFAULT_TIMEZONE = "America/Toronto";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const partFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(tz: string): Intl.DateTimeFormat {
  let f = dateFormatters.get(tz);
  if (!f) {
    // en-CA prints YYYY-MM-DD, which is exactly the storage format.
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatters.set(tz, f);
  }
  return f;
}

function partFormatter(tz: string): Intl.DateTimeFormat {
  let f = partFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partFormatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isDateString(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function toLocalDate(unixSeconds: number, tz: string): string {
  return dateFormatter(tz).format(new Date(unixSeconds * 1000));
}

export function todayLocal(tz: string, nowMs: number = Date.now()): string {
  return dateFormatter(tz).format(new Date(nowMs));
}

function split(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Calendar days added to a YYYY-MM-DD string; no timezone involved. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = split(date);
  return fromUtcMs(Date.UTC(y, m - 1, d + n));
}

/** b minus a, in whole calendar days (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = split(a);
  const [by, bm, bd] = split(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** The zone's UTC offset at a given instant, in milliseconds (positive east of UTC). */
function offsetMs(utcMs: number, tz: string): number {
  const parts = partFormatter(tz).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The instant (ms since epoch) at which the given local date begins in the zone. */
export function localMidnightMs(date: string, tz: string): number {
  const [y, m, d] = split(date);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetMs(guess, tz);
  // If the offset differs at the candidate instant (we crossed a DST boundary), correct once.
  const second = guess - offsetMs(first, tz);
  return second;
}
