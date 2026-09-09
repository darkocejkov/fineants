import "dotenv/config";
import { loadConfig } from "../src/lib/config";
import { claimSetupToken } from "../src/lib/simplefin/claim";

async function main() {
  const config = loadConfig();
  const token = process.argv[2] ?? config.simplefinSetupToken;
  if (!token) {
    console.error("Usage: npm run claim -- <setup-token>   (or set SIMPLEFIN_SETUP_TOKEN in .env)");
    process.exit(1);
  }
  const accessUrl = await claimSetupToken(token);
  console.log("\nClaimed. Add this line to .env and remove SIMPLEFIN_SETUP_TOKEN:\n");
  console.log(`SIMPLEFIN_ACCESS_URL=${accessUrl}\n`);
  console.log("The setup token is now used up; this URL is your only credential. Keep it private.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
