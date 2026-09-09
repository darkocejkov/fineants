export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadConfig } = await import("./lib/config");
    const { getDb } = await import("./lib/db/client");
    const { startScheduler } = await import("./lib/sync/scheduler");
    const config = loadConfig();
    const db = getDb();
    startScheduler({ db, config });
  }
}
