import "dotenv/config";
import { loadConfig } from "../src/lib/config";
import { createDb } from "../src/lib/db/client";
import { runDataSteps } from "../src/lib/db/bootstrap";

const config = loadConfig();
const db = createDb(config.databasePath);
const r = runDataSteps(db, { timezone: config.timezone });
console.log(`Migrated ${config.databasePath}; local dates ${r.localDatesBackfilled}, categories ${r.categoriesSeeded}, connections ${r.connectionsSeeded}${r.timezoneRecomputed ? ", timezone recomputed" : ""}`);
