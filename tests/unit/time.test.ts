import { describe, it, expect } from "vitest";
import { DEFAULT_TIMEZONE, isValidTimeZone, toLocalDate, todayLocal, addDays, daysBetween, localMidnightMs, isDateString } from "@/lib/time";

const TZ = "America/Toronto";

describe("toLocalDate", () => {
  it("renders an instant as the local calendar date", () => {
    // 2026-09-09T03:30:00Z is 2026-09-08 23:30 in Toronto (EDT, UTC-4)
    expect(toLocalDate(Date.UTC(2026, 8, 9, 3, 30) / 1000, TZ)).toBe("2026-09-08");
    expect(toLocalDate(Date.UTC(2026, 8, 9, 3, 30) / 1000, "UTC")).toBe("2026-09-09");
  });
  it("handles the spring-forward day (2026-03-08, EST to EDT)", () => {
    // 06:30Z on 2026-03-08 is 01:30 EST; 07:30Z is 03:30 EDT (02:xx does not exist). Both same date.
    expect(toLocalDate(Date.UTC(2026, 2, 8, 6, 30) / 1000, TZ)).toBe("2026-03-08");
    expect(toLocalDate(Date.UTC(2026, 2, 8, 7, 30) / 1000, TZ)).toBe("2026-03-08");
    // 04:59Z on 2026-03-08 is still 2026-03-07 23:59 EST
    expect(toLocalDate(Date.UTC(2026, 2, 8, 4, 59) / 1000, TZ)).toBe("2026-03-07");
  });
  it("handles the fall-back day (2026-11-01, EDT to EST)", () => {
    // 03:59Z on 2026-11-01 is 23:59 EDT on 2026-10-31
    expect(toLocalDate(Date.UTC(2026, 10, 1, 3, 59) / 1000, TZ)).toBe("2026-10-31");
    // 05:00Z on 2026-11-01 is 01:00 EDT... then clocks fall back; 06:30Z is 01:30 EST — same date
    expect(toLocalDate(Date.UTC(2026, 10, 1, 6, 30) / 1000, TZ)).toBe("2026-11-01");
  });
});

describe("todayLocal", () => {
  it("uses the given clock", () => {
    expect(todayLocal(TZ, Date.UTC(2026, 8, 9, 3, 30))).toBe("2026-09-08");
  });
});

describe("date arithmetic", () => {
  it("adds and subtracts days across month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("counts days between dates, signed", () => {
    expect(daysBetween("2026-09-01", "2026-09-09")).toBe(8);
    expect(daysBetween("2026-09-09", "2026-09-01")).toBe(-8);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2); // DST does not change calendar distance
  });
  it("validates date strings", () => {
    expect(isDateString("2026-09-09")).toBe(true);
    expect(isDateString("2026-9-9")).toBe(false);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("nope")).toBe(false);
  });
});

describe("localMidnightMs", () => {
  it("finds the instant of local midnight, honouring DST", () => {
    expect(localMidnightMs("2026-09-09", TZ)).toBe(Date.UTC(2026, 8, 9, 4)); // EDT: 04:00Z
    expect(localMidnightMs("2026-01-15", TZ)).toBe(Date.UTC(2026, 0, 15, 5)); // EST: 05:00Z
    expect(localMidnightMs("2026-03-08", TZ)).toBe(Date.UTC(2026, 2, 8, 5)); // midnight before the jump is still EST
    expect(localMidnightMs("2026-09-09", "UTC")).toBe(Date.UTC(2026, 8, 9));
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects junk", () => {
    expect(isValidTimeZone(DEFAULT_TIMEZONE)).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
