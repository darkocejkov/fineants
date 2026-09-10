import "dotenv/config";
import { loadConfig, requireAccessUrl } from "../src/lib/config";
import { createDb } from "../src/lib/db/client";
import { runDataSteps } from "../src/lib/db/bootstrap";
import { runSync } from "../src/lib/sync/engine";

async function main() {
  const config = loadConfig();
  const force = process.argv.includes("--force");
  const db = createDb(config.databasePath);
  runDataSteps(db, { timezone: config.timezone });
  const result = await runSync({ db, accessUrl: config.simplefinAccessUrl, backfillDays: config.backfillDays, timezone: config.timezone }, { trigger: "cli", force });
  if (result.skipped === "no_access_url") {
    // The engine reports a token; requireAccessUrl owns the sentence that tells a CLI user
    // — the one surface with no UI to map it — what to do about it.
    try {
      requireAccessUrl(config);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
    return;
  }
  if (result.skipped) {
    console.log(`Skipped: ${result.skipped}${result.skipped === "rate_limited" ? " (use --force to override)" : ""}`);
    if (result.skipped === "credentials_invalid") process.exitCode = 1;
    return;
  }
  for (const r of result.runs) {
    const w = `${new Date(r.windowStart * 1000).toISOString().slice(0, 10)}..${new Date(r.windowEnd * 1000).toISOString().slice(0, 10)}`;
    console.log(`run #${r.runId} ${r.status} ${w} accounts=${r.accountsSeen} tx=${r.transactionsUpserted} pendingRemoved=${r.pendingRemoved}${r.error ? ` error=${r.error}` : ""}`);
    for (const e of r.errlist) console.log(`  errlist ${e.code}: ${e.msg}`);
  }
  if (result.tagging) {
    const t = result.tagging;
    console.log(`tagging categorised=${t.categorised} cleared=${t.categoryCleared} transfers=${t.transfersPaired} in ${t.durationMs}ms${t.invalidRules.length ? ` invalidRules=${t.invalidRules.map((r) => r.id).join(",")}` : ""}`);
  }
  if (result.runs.some((r) => r.status === "failed")) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
