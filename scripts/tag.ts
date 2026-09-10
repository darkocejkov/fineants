import "dotenv/config";
import { loadConfig } from "../src/lib/config";
import { createDb } from "../src/lib/db/client";
import { runDataSteps } from "../src/lib/db/bootstrap";
import { applyTagging } from "../src/lib/tagging/apply";

const config = loadConfig();
const db = createDb(config.databasePath);
runDataSteps(db, { timezone: config.timezone });
const t = applyTagging(db);
console.log(`tagging categorised=${t.categorised} cleared=${t.categoryCleared} transfers=${t.transfersPaired} transfersCleared=${t.transfersCleared} in ${t.durationMs}ms`);
for (const r of t.invalidRules) console.log(`  rule ${r.id} skipped: ${r.error}`);
