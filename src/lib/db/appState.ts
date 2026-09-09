import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { appState } from "./schema";

export const STATE_KEYS = {
  credentialsInvalid: "credentials_invalid",
  lastSuccessfulSyncEnd: "last_successful_sync_end",
  schedulerMinuteOffset: "scheduler_minute_offset",
} as const;

export function getState<T>(db: Db, key: string): T | undefined {
  const row = db.select().from(appState).where(eq(appState.key, key)).get();
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function setState(db: Db, key: string, value: unknown): void {
  const json = JSON.stringify(value);
  db.insert(appState)
    .values({ key, value: json })
    .onConflictDoUpdate({ target: appState.key, set: { value: json } })
    .run();
}

export function deleteState(db: Db, key: string): void {
  db.delete(appState).where(eq(appState.key, key)).run();
}
