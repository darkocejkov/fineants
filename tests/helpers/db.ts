import { createDb, type Db } from "@/lib/db/client";

export function makeTestDb(): Db {
  return createDb(":memory:");
}
