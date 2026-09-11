import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeTestDb } from "../helpers/db";
import { makeFetchMock, jsonResponse } from "../helpers/fetch";
import { syncRuns } from "@/lib/db/schema";

// The bank data is already stored by the time tagging runs, so a defect in the pass must read as
// a partial run rather than a sync failure. Mocking is file-wide, hence a file of its own: every
// other engine test needs the real pass.
vi.mock("@/lib/tagging/apply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tagging/apply")>();
  return {
    ...actual,
    applyTagging: () => {
      throw new Error("boom");
    },
  };
});

const { runSync } = await import("@/lib/sync/engine");

const ACCESS = "https://u:p@bridge.example/simplefin";
const NOW_MS = 1_757_400_000_000;

/** old-shape.json without its legacy error, so the runs are clean until tagging throws. */
function oldShapeHealthy() {
  const f = JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "simplefin", "old-shape.json"), "utf8"));
  f.errors = [];
  return f;
}

describe("runSync when the tagging pass throws", () => {
  it("marks the last run partial with a tagging error and still resolves", async () => {
    const db = makeTestDb();
    const fetchImpl = makeFetchMock(() => jsonResponse(oldShapeHealthy()));
    const r = await runSync({ db, accessUrl: ACCESS, backfillDays: 365, fetchImpl, now: () => NOW_MS, timezone: "America/Toronto" }, { trigger: "cli" });

    expect(r.tagging).toBeUndefined();
    expect(r.runs.length).toBeGreaterThan(0);
    const last = r.runs.at(-1)!;
    expect(last.status).toBe("partial");
    expect(last.error).toMatch(/^tagging: /);
    expect(last.error).toContain("boom");

    const stored = db.select().from(syncRuns).orderBy(syncRuns.id).all().at(-1)!;
    expect(stored.status).toBe("partial");
    expect(stored.error).toBe(last.error);
  });
});
