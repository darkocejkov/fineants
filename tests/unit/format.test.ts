import { describe, it, expect } from "vitest";
import { unixToDate, isoToLocal, relativeFromNow } from "@/lib/format";

describe("format", () => {
  it("unixToDate", () => {
    // 1788936000 = 2026-09-09T06:40:00Z; the time of day is dropped.
    expect(unixToDate(1788936000)).toBe("2026-09-09");
  });
  it("isoToLocal", () => {
    expect(isoToLocal("2026-09-09T13:05:00.000Z")).toBe("2026-09-09 13:05");
    expect(isoToLocal(null)).toBe("—");
  });
  it("relativeFromNow", () => {
    const now = Date.parse("2026-09-09T13:05:00Z");
    expect(relativeFromNow(null, now)).toBe("never");
    expect(relativeFromNow("2026-09-09T13:04:30Z", now)).toBe("just now");
    expect(relativeFromNow("2026-09-09T13:02:00Z", now)).toBe("3 min ago");
    expect(relativeFromNow("2026-09-09T11:05:00Z", now)).toBe("2 h ago");
    expect(relativeFromNow("2026-09-04T13:05:00Z", now)).toBe("5 d ago");
  });
});
