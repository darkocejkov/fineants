import { describe, it, expect } from "vitest";
import { changeSentence, whenSynced } from "@/lib/sentences";

// 2026-09-09 is a Wednesday; 09-08 Tuesday, 09-03 Thursday, 08-25 Tuesday.
const NOW = Date.parse("2026-09-09T13:05:00Z");

const point = (date: string, balanceCents: number) => ({ date, balanceCents });

describe("whenSynced", () => {
  it("names a date inside the last week by its weekday", () => {
    expect(whenSynced("2026-09-08", NOW)).toBe("Tuesday's sync");
    expect(whenSynced("2026-09-03", NOW)).toBe("Thursday's sync");
  });

  it("names anything older than six days by its date", () => {
    expect(whenSynced("2026-09-02", NOW)).toBe("the 2026-09-02 sync");
    expect(whenSynced("2026-08-25", NOW)).toBe("the 2026-08-25 sync");
  });

  it("falls back to the date it was given when that is not parseable", () => {
    expect(whenSynced("not-a-date", NOW)).toBe("the not-a-date sync");
  });
});

describe("changeSentence", () => {
  it("says there is nothing to compare with fewer than two points", () => {
    expect(changeSentence([], "CAD", NOW)).toBe("No earlier snapshot to compare yet.");
    expect(changeSentence([point("2026-09-09", 50000)], "CAD", NOW)).toBe("No earlier snapshot to compare yet.");
  });

  it("leads with Up when the balance rose", () => {
    const s = changeSentence([point("2026-09-08", 50000), point("2026-09-09", 81240)], "CAD", NOW);
    expect(s.startsWith("Up")).toBe(true);
    expect(s).toBe("Up $312.40 since Tuesday's sync.");
  });

  it("leads with Down when the balance fell", () => {
    const s = changeSentence([point("2026-09-08", 55000), point("2026-09-09", 50000)], "CAD", NOW);
    expect(s.startsWith("Down")).toBe(true);
    expect(s).toBe("Down $50.00 since Tuesday's sync.");
  });

  it("says unchanged when the balance held", () => {
    expect(changeSentence([point("2026-09-08", 50000), point("2026-09-09", 50000)], "CAD", NOW)).toBe(
      "Unchanged since Tuesday's sync.",
    );
  });

  it("compares the last two points and formats in the series currency", () => {
    const points = [point("2026-08-25", 100), point("2026-09-03", 250000), point("2026-09-09", 260000)];
    expect(changeSentence(points, "USD", NOW)).toBe("Up US$100.00 since Thursday's sync.");
  });
});
