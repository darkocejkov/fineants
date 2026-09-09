import "dotenv/config";
import { loadConfig } from "../src/lib/config";
import { createDb } from "../src/lib/db/client";

const config = loadConfig();
createDb(config.databasePath);
console.log(`Migrated ${config.databasePath}`);
