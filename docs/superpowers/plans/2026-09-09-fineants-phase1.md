# fineants Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js app that syncs a SimpleFin Bridge account into SQLite on a schedule, exposes a raw explorer plus balance/transaction/spending dashboards, and serves a small API-key-protected JSON API.

**Architecture:** All logic lives in plain TypeScript under `src/lib` (config, money, db, simplefin client, sync engine, queries) with no Next.js or React imports; it is exercised by Vitest with an in-memory SQLite and a mocked `fetch`. Next.js App Router pages are server components that call `src/lib/queries` directly; route handlers, the scheduler started from `instrumentation.ts`, and two `tsx` scripts are thin adapters over `src/lib/sync`.

**Tech Stack:** Next.js 16 (App Router, `output: "standalone"`), React 19, TypeScript, Tailwind 4, Drizzle ORM 0.45 + better-sqlite3 13, zod 4, Recharts 3, Vitest 5, tsx, Docker.

**Spec:** `docs/superpowers/specs/2026-09-09-fineants-phase1-design.md`

## Global Constraints

- Nothing under `src/lib/**` imports from `next/*`, `react`, or `react-dom`.
- Money is stored and transported as integer cents (`*_cents`, `*Cents`) plus a `currency` string. Never floats.
- SimpleFin timestamps stay Unix **seconds** (integers). fineants-generated timestamps (`*_at`) are ISO-8601 strings.
- One SimpleFin request covers at most 90 days; consecutive windows overlap by 5 days; a sync is skipped if the last run started under 30 minutes ago unless forced.
- The parser must accept both wire shapes (old: `errors`/`org`/`payee`/`memo`; new: `errlist`/`connections`/`conn_id`) and preserve unknown fields in `raw`.
- The app never claims a setup token automatically; only `npm run claim` does.
- `.env` is gitignored; `.env.example` is committed. Env names: `SIMPLEFIN_ACCESS_URL`, `SIMPLEFIN_SETUP_TOKEN`, `DATABASE_PATH` (default `./data/fineants.db`), `SYNC_INTERVAL_HOURS` (default `6`, `0` disables), `BACKFILL_DAYS` (default `365`), `API_KEY`, `PORT` (default `3000`).
- All `/api/*` routes require header `x-api-key`; `POST /api/sync` additionally accepts same-origin browser requests.
- Tests never touch the network. Run `npm test` before every commit.
- Commit after every task with a conventional-commit message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File structure

```
next.config.ts                    standalone output, serverExternalPackages: better-sqlite3
drizzle.config.ts                 sqlite dialect, schema + migrations paths
vitest.config.ts                  node env, @ alias
.env.example
Dockerfile, docker-compose.yml, .dockerignore
src/lib/config.ts                 loadConfig(env) -> Config; requireAccessUrl; requireApiKey
src/lib/money.ts                  parseAmountToCents; formatCents
src/lib/db/schema.ts              drizzle tables (connections, accounts, transactions, balance_snapshots, sync_runs, app_state)
src/lib/db/client.ts              createDb(path) with migrations; getDb() singleton
src/lib/db/appState.ts            getState/setState/deleteState typed helpers
src/lib/db/migrations/            drizzle-kit output (committed)
src/lib/simplefin/types.ts        normalised domain types
src/lib/simplefin/schema.ts       zod wire schemas + parseAccountSet
src/lib/simplefin/client.ts       fetchAccounts, buildAccountsUrl, error classes
src/lib/simplefin/claim.ts        claimSetupToken
src/lib/sync/windows.ts           computeWindows
src/lib/sync/engine.ts            runSync
src/lib/sync/scheduler.ts         startScheduler
src/lib/queries/accounts.ts       listAccounts, getAccount, totalsByCurrency, updateAccountSettings
src/lib/queries/balances.ts       netWorthSeries, accountBalanceSeries
src/lib/queries/transactions.ts   listTransactions, recentTransactions
src/lib/queries/spending.ts       spendingByPeriod, topPayees
src/lib/queries/syncRuns.ts       listSyncRuns, getSyncRun, latestSyncRun
src/lib/api/auth.ts               isAuthorised(req, config, {allowSameOrigin})
src/lib/format.ts                 date helpers for UI (server-safe)
src/instrumentation.ts            register() -> startScheduler
src/app/layout.tsx, page.tsx, globals.css
src/app/transactions/page.tsx
src/app/accounts/[id]/page.tsx
src/app/spending/page.tsx
src/app/explorer/page.tsx, explorer/[runId]/page.tsx
src/app/settings/page.tsx, settings/actions.ts
src/app/api/sync/route.ts
src/app/api/v1/summary/route.ts
src/app/api/v1/spending/route.ts
src/components/Nav.tsx, Amount.tsx, SyncButton.tsx, ErrorBanner.tsx, EmptyState.tsx
src/components/charts/NetWorthChart.tsx, BalanceChart.tsx, SpendingChart.tsx
scripts/claim.ts, scripts/sync.ts
tests/fixtures/simplefin/old-shape.json, new-shape.json, errlist-only.json
tests/unit/*.test.ts, tests/integration/*.test.ts, tests/api/*.test.ts
tests/helpers/db.ts               makeTestDb(), makeFetchMock()
```

---

### Task 1: Scaffold the Next.js project and test tooling

**Files:**
- Create: everything create-next-app generates, `vitest.config.ts`, `.env.example`, `drizzle.config.ts`
- Modify: `next.config.ts`, `package.json` (scripts), `tsconfig.json`

**Interfaces:**
- Produces: `npm test`, `npm run dev`, `@/*` alias to `src/*`, `data/` directory ignored by git.

- [ ] **Step 1: Scaffold with create-next-app into the existing directory**

```bash
cd /Users/darkocejkov/Documents/fineants
npx --yes create-next-app@16.3.4 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git --yes
```
Expected: it accepts the non-empty directory because only `.gitignore` and `docs/` exist (both on its allow-list). If it complains about conflicts, move `docs/` aside, run, and move it back.

- [ ] **Step 2: Install runtime and dev dependencies**

```bash
npm install drizzle-orm@^0.45.2 better-sqlite3@^13.0.3 zod@^4.5.4 recharts@^3.10.1
npm install -D drizzle-kit@^0.31.10 @types/better-sqlite3@^9.6.0 vitest@^5.0.0 tsx@^4.23.13 dotenv@^17.4.2
```

- [ ] **Step 3: Configure Next for native SQLite and standalone output**

Replace `next.config.ts` with:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

- [ ] **Step 4: Add Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```
Add `"types": ["vitest/globals"]` is NOT needed; tests import from `vitest` explicitly.

- [ ] **Step 5: Add drizzle-kit config**

Create `drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dbCredentials: { url: process.env.DATABASE_PATH ?? "./data/fineants.db" },
});
```

- [ ] **Step 6: Add npm scripts**

In `package.json` `"scripts"`, set:
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx scripts/migrate.ts",
  "claim": "tsx scripts/claim.ts",
  "sync": "tsx scripts/sync.ts"
}
```

- [ ] **Step 7: Add `.env.example`**

```dotenv
# From `npm run claim` (paste the printed access URL here). Format: https://user:pass@beta-bridge.simplefin.org/simplefin
SIMPLEFIN_ACCESS_URL=

# Only used by `npm run claim`. One-time use; remove after claiming.
SIMPLEFIN_SETUP_TOKEN=

# SQLite file. In Docker this is /data/fineants.db
DATABASE_PATH=./data/fineants.db

# Hours between scheduled syncs. 0 disables the scheduler.
SYNC_INTERVAL_HOURS=6

# How far back the first sync reaches.
BACKFILL_DAYS=365

# Required by /api/sync and /api/v1/* (header x-api-key). Generate with: openssl rand -hex 32
API_KEY=

PORT=3000
```

- [ ] **Step 8: Create a smoke test so `npm test` is green**

Create `tests/unit/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```
Run: `npm test`
Expected: 1 passed.

- [ ] **Step 9: Verify the dev server builds**

Run: `npm run build`
Expected: build succeeds (default create-next-app page). Delete `tests/unit/smoke.test.ts` in Task 2 once real tests exist.

- [ ] **Step 10: Commit**

```bash
mkdir -p data && touch data/.gitkeep
git add -A
git commit -m "chore: scaffold Next.js 16 app with Drizzle, Vitest, and env template

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
Note: `.gitignore` ignores `data/` so `.gitkeep` will not be added; that is fine, `createDb` creates the directory.

---

### Task 2: Money helpers

**Files:**
- Create: `src/lib/money.ts`, `tests/unit/money.test.ts`
- Delete: `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces:
  - `parseAmountToCents(value: string | number): number` — `"-12.34"` → `-1234`; throws `MoneyParseError` on NaN, empty, or more than 2 decimals.
  - `formatCents(cents: number, currency: string, locale?: string): string` — uses `Intl.NumberFormat` when `currency` is a 3-letter code, otherwise `"<sign><units>.<cc> <currency>"`.

- [ ] **Step 1: Write failing tests**

`tests/unit/money.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseAmountToCents, formatCents, MoneyParseError } from "@/lib/money";

describe("parseAmountToCents", () => {
  it("parses positive and negative decimals", () => {
    expect(parseAmountToCents("12.34")).toBe(1234);
    expect(parseAmountToCents("-12.34")).toBe(-1234);
  });
  it("parses integers and single decimals", () => {
    expect(parseAmountToCents("1000")).toBe(100000);
    expect(parseAmountToCents("0.5")).toBe(50);
    expect(parseAmountToCents("-0.5")).toBe(-50);
  });
  it("normalises negative zero", () => {
    expect(Object.is(parseAmountToCents("-0.00"), 0)).toBe(true);
  });
  it("accepts numbers", () => {
    expect(parseAmountToCents(3.5)).toBe(350);
  });
  it("rejects more than two decimals", () => {
    expect(() => parseAmountToCents("1.234")).toThrow(MoneyParseError);
  });
  it("rejects garbage", () => {
    expect(() => parseAmountToCents("abc")).toThrow(MoneyParseError);
    expect(() => parseAmountToCents("")).toThrow(MoneyParseError);
  });
});

describe("formatCents", () => {
  it("formats ISO currencies", () => {
    expect(formatCents(-1234, "CAD", "en-CA")).toBe("-$12.34");
    expect(formatCents(100000, "USD", "en-US")).toBe("$1,000.00");
  });
  it("falls back for non-ISO currency strings", () => {
    expect(formatCents(1234, "https://example.org/coin")).toBe("12.34 https://example.org/coin");
    expect(formatCents(-5, "XXXX")).toBe("-0.05 XXXX");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `rm tests/unit/smoke.test.ts && npx vitest run tests/unit/money.test.ts`
Expected: FAIL, cannot resolve `@/lib/money`.

- [ ] **Step 3: Implement**

`src/lib/money.ts`:
```ts
export class MoneyParseError extends Error {
  constructor(value: unknown) {
    super(`Cannot parse money amount: ${JSON.stringify(value)}`);
    this.name = "MoneyParseError";
  }
}

const AMOUNT_RE = /^([+-])?(\d+)(?:\.(\d{1,2}))?$/;

export function parseAmountToCents(value: string | number): number {
  const str = typeof value === "number" ? value.toFixed(2) : value.trim();
  const m = AMOUNT_RE.exec(str);
  if (!m) throw new MoneyParseError(value);
  const sign = m[1] === "-" ? -1 : 1;
  const units = Number(m[2]);
  const frac = m[3] ? Number(m[3].padEnd(2, "0")) : 0;
  const cents = sign * (units * 100 + frac);
  return cents === 0 ? 0 : cents;
}

export function formatCents(cents: number, currency: string, locale = "en-CA"): string {
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
    } catch {
      // unknown ISO code, fall through
    }
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${units}.${frac} ${currency}`;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass. If the `"XXXX"` case prints via Intl, note the regex only admits 3 uppercase letters, so it falls through correctly.

- [ ] **Step 5: Commit**

```bash
git add src/lib/money.ts tests/unit/money.test.ts
git rm -q tests/unit/smoke.test.ts
git commit -m "feat(money): parse SimpleFin amount strings to integer cents

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Config loader

**Files:**
- Create: `src/lib/config.ts`, `tests/unit/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Config = {
    simplefinAccessUrl?: string; simplefinSetupToken?: string;
    databasePath: string; syncIntervalHours: number; backfillDays: number;
    apiKey?: string; port: number;
  };
  loadConfig(env?: NodeJS.ProcessEnv): Config          // cached per env object identity is NOT needed; call freely
  requireAccessUrl(config: Config): string             // throws ConfigError("SIMPLEFIN_ACCESS_URL is not set…")
  requireApiKey(config: Config): string                // throws ConfigError
  class ConfigError extends Error
  ```

- [ ] **Step 1: Write failing tests**

`tests/unit/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig, requireAccessUrl, requireApiKey, ConfigError } from "@/lib/config";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({});
    expect(c.databasePath).toBe("./data/fineants.db");
    expect(c.syncIntervalHours).toBe(6);
    expect(c.backfillDays).toBe(365);
    expect(c.port).toBe(3000);
    expect(c.simplefinAccessUrl).toBeUndefined();
    expect(c.apiKey).toBeUndefined();
  });
  it("reads values and coerces numbers", () => {
    const c = loadConfig({
      SIMPLEFIN_ACCESS_URL: "https://u:p@bridge.example/simplefin",
      DATABASE_PATH: "/data/x.db",
      SYNC_INTERVAL_HOURS: "0",
      BACKFILL_DAYS: "30",
      API_KEY: "k",
      PORT: "4000",
    });
    expect(c.simplefinAccessUrl).toBe("https://u:p@bridge.example/simplefin");
    expect(c.databasePath).toBe("/data/x.db");
    expect(c.syncIntervalHours).toBe(0);
    expect(c.backfillDays).toBe(30);
    expect(c.apiKey).toBe("k");
    expect(c.port).toBe(4000);
  });
  it("treats empty strings as unset", () => {
    const c = loadConfig({ SIMPLEFIN_ACCESS_URL: "", API_KEY: "  " });
    expect(c.simplefinAccessUrl).toBeUndefined();
    expect(c.apiKey).toBeUndefined();
  });
  it("rejects a non-URL access url", () => {
    expect(() => loadConfig({ SIMPLEFIN_ACCESS_URL: "not a url" })).toThrow(ConfigError);
  });
  it("rejects negative or non-numeric numbers", () => {
    expect(() => loadConfig({ SYNC_INTERVAL_HOURS: "-1" })).toThrow(ConfigError);
    expect(() => loadConfig({ BACKFILL_DAYS: "abc" })).toThrow(ConfigError);
  });
});

describe("require helpers", () => {
  it("throw ConfigError with the variable name", () => {
    const c = loadConfig({});
    expect(() => requireAccessUrl(c)).toThrow(/SIMPLEFIN_ACCESS_URL/);
    expect(() => requireApiKey(c)).toThrow(/API_KEY/);
  });
  it("return the value when set", () => {
    const c = loadConfig({ SIMPLEFIN_ACCESS_URL: "https://u:p@h/simplefin", API_KEY: "k" });
    expect(requireAccessUrl(c)).toBe("https://u:p@h/simplefin");
    expect(requireApiKey(c)).toBe("k");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/lib/config.ts`:
```ts
import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const optionalString = z
  .string()
  .optional()
  .transform((v) => {
    const t = v?.trim();
    return t ? t : undefined;
  });

const nonNegativeInt = (def: number) =>
  optionalString.transform((v, ctx) => {
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: `must be a non-negative integer, got ${JSON.stringify(v)}` });
      return z.NEVER;
    }
    return n;
  });

const envSchema = z.object({
  SIMPLEFIN_ACCESS_URL: optionalString.refine(
    (v) => v === undefined || /^https?:\/\/.+/.test(v),
    { message: "must be an http(s) URL" },
  ),
  SIMPLEFIN_SETUP_TOKEN: optionalString,
  DATABASE_PATH: optionalString.transform((v) => v ?? "./data/fineants.db"),
  SYNC_INTERVAL_HOURS: nonNegativeInt(6),
  BACKFILL_DAYS: nonNegativeInt(365),
  API_KEY: optionalString,
  PORT: nonNegativeInt(3000),
});

export type Config = {
  simplefinAccessUrl?: string;
  simplefinSetupToken?: string;
  databasePath: string;
  syncIntervalHours: number;
  backfillDays: number;
  apiKey?: string;
  port: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n${lines.join("\n")}`);
  }
  const e = result.data;
  return {
    simplefinAccessUrl: e.SIMPLEFIN_ACCESS_URL,
    simplefinSetupToken: e.SIMPLEFIN_SETUP_TOKEN,
    databasePath: e.DATABASE_PATH,
    syncIntervalHours: e.SYNC_INTERVAL_HOURS,
    backfillDays: e.BACKFILL_DAYS,
    apiKey: e.API_KEY,
    port: e.PORT,
  };
}

export function requireAccessUrl(config: Config): string {
  if (!config.simplefinAccessUrl) {
    throw new ConfigError(
      "SIMPLEFIN_ACCESS_URL is not set. Run `npm run claim` with SIMPLEFIN_SETUP_TOKEN set, then paste the access URL into .env.",
    );
  }
  return config.simplefinAccessUrl;
}

export function requireApiKey(config: Config): string {
  if (!config.apiKey) {
    throw new ConfigError("API_KEY is not set. Generate one with `openssl rand -hex 32` and add it to .env.");
  }
  return config.apiKey;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass. If zod 4 rejects `optionalString.refine` chaining after `.transform`, replace with a `.superRefine` on the object; the tests define the behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts tests/unit/config.test.ts
git commit -m "feat(config): typed env loader with defaults and require helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Database schema, client, migrations, app state

**Files:**
- Create: `src/lib/db/schema.ts`, `src/lib/db/client.ts`, `src/lib/db/appState.ts`, `src/lib/db/migrations/*` (generated), `scripts/migrate.ts`, `tests/helpers/db.ts`, `tests/unit/db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // schema.ts
  export const connections, accounts, transactions, balanceSnapshots, syncRuns, appState;  // drizzle tables
  export type AccountRow = typeof accounts.$inferSelect; TransactionRow; SyncRunRow; BalanceSnapshotRow; ConnectionRow
  export const ACCOUNT_TYPES = ["checking","savings","credit","loan","investment","other"] as const; type AccountType
  // client.ts
  export type Db = BetterSQLite3Database<typeof schema>
  export function createDb(path: string, opts?: { migrationsFolder?: string }): Db   // ":memory:" allowed; creates parent dir; WAL for files; runs migrations
  export function getDb(): Db                                                        // singleton from loadConfig().databasePath, cached on globalThis
  export function nowIso(): string
  // appState.ts
  export function getState<T>(db: Db, key: string): T | undefined
  export function setState(db: Db, key: string, value: unknown): void
  export function deleteState(db: Db, key: string): void
  export const STATE_KEYS = { credentialsInvalid: "credentials_invalid", lastSuccessfulSyncEnd: "last_successful_sync_end", schedulerMinuteOffset: "scheduler_minute_offset" } as const
  // tests/helpers/db.ts
  export function makeTestDb(): Db  // in-memory, migrated
  ```

- [ ] **Step 1: Write the schema**

`src/lib/db/schema.ts`:
```ts
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const ACCOUNT_TYPES = ["checking", "savings", "credit", "loan", "investment", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain"),
  url: text("url"),
  sfinUrl: text("sfin_url"),
  raw: text("raw").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull().references(() => connections.id),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  balanceCents: integer("balance_cents").notNull(),
  availableBalanceCents: integer("available_balance_cents"),
  balanceDate: integer("balance_date").notNull(),
  raw: text("raw").notNull(),
  nickname: text("nickname"),
  type: text("type", { enum: ACCOUNT_TYPES }),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => accounts.id),
    posted: integer("posted").notNull(),
    transactedAt: integer("transacted_at"),
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    payee: text("payee"),
    memo: text("memo"),
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
    raw: text("raw").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (t) => [
    index("transactions_account_posted_idx").on(t.accountId, t.posted),
    index("transactions_posted_idx").on(t.posted),
    index("transactions_pending_idx").on(t.pending),
  ],
);

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trigger: text("trigger", { enum: ["scheduled", "manual", "cli"] }).notNull(),
  status: text("status", { enum: ["running", "success", "partial", "failed"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  windowStart: integer("window_start").notNull(),
  windowEnd: integer("window_end").notNull(),
  httpStatus: integer("http_status"),
  accountsSeen: integer("accounts_seen").notNull().default(0),
  transactionsUpserted: integer("transactions_upserted").notNull().default(0),
  pendingRemoved: integer("pending_removed").notNull().default(0),
  errlist: text("errlist").notNull().default("[]"),
  error: text("error"),
  rawResponse: text("raw_response"),
});

export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: text("account_id").notNull().references(() => accounts.id),
    syncRunId: integer("sync_run_id").notNull().references(() => syncRuns.id),
    balanceCents: integer("balance_cents").notNull(),
    availableBalanceCents: integer("available_balance_cents"),
    balanceDate: integer("balance_date").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [index("balance_snapshots_account_recorded_idx").on(t.accountId, t.recordedAt)],
);

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type ConnectionRow = typeof connections.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type SyncRunRow = typeof syncRuns.$inferSelect;
export type BalanceSnapshotRow = typeof balanceSnapshots.$inferSelect;
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: `src/lib/db/migrations/0000_*.sql` and `meta/` created. Open the SQL and confirm six tables and four indexes.

- [ ] **Step 3: Write the client and app state helpers**

`src/lib/db/client.ts`:
```ts
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { loadConfig } from "../config";

export type Db = BetterSQLite3Database<typeof schema>;

const DEFAULT_MIGRATIONS = path.join(process.cwd(), "src", "lib", "db", "migrations");

export function nowIso(): string {
  return new Date().toISOString();
}

export function createDb(dbPath: string, opts: { migrationsFolder?: string } = {}): Db {
  const isMemory = dbPath === ":memory:";
  if (!isMemory) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  if (!isMemory) sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: opts.migrationsFolder ?? process.env.MIGRATIONS_DIR ?? DEFAULT_MIGRATIONS });
  return db;
}

const g = globalThis as unknown as { __fineantsDb?: Db };

export function getDb(): Db {
  if (!g.__fineantsDb) {
    g.__fineantsDb = createDb(loadConfig().databasePath);
  }
  return g.__fineantsDb;
}
```

`src/lib/db/appState.ts`:
```ts
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
```

`scripts/migrate.ts`:
```ts
import "dotenv/config";
import { loadConfig } from "../src/lib/config";
import { createDb } from "../src/lib/db/client";

const config = loadConfig();
createDb(config.databasePath);
console.log(`Migrated ${config.databasePath}`);
```

`tests/helpers/db.ts`:
```ts
import { createDb, type Db } from "@/lib/db/client";

export function makeTestDb(): Db {
  return createDb(":memory:");
}
```

- [ ] **Step 4: Write tests**

`tests/unit/db.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { getState, setState, deleteState } from "@/lib/db/appState";

describe("createDb", () => {
  it("creates all tables", () => {
    const db = makeTestDb();
    const rows = db.all<{ name: string }>(sql`select name from sqlite_master where type='table' order by name`);
    const names = rows.map((r) => r.name);
    for (const t of ["accounts", "app_state", "balance_snapshots", "connections", "sync_runs", "transactions"]) {
      expect(names).toContain(t);
    }
  });
});

describe("appState", () => {
  it("round-trips JSON values and overwrites", () => {
    const db = makeTestDb();
    expect(getState(db, "k")).toBeUndefined();
    setState(db, "k", { a: 1 });
    expect(getState<{ a: number }>(db, "k")).toEqual({ a: 1 });
    setState(db, "k", 42);
    expect(getState<number>(db, "k")).toBe(42);
    deleteState(db, "k");
    expect(getState(db, "k")).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: pass. If better-sqlite3 fails to load under Node 24, run `npm rebuild better-sqlite3`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db scripts/migrate.ts tests/helpers/db.ts tests/unit/db.test.ts
git commit -m "feat(db): drizzle schema, sqlite client with migrations, app state helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: SimpleFin wire schema and normaliser

**Files:**
- Create: `src/lib/simplefin/types.ts`, `src/lib/simplefin/schema.ts`, `tests/fixtures/simplefin/old-shape.json`, `tests/fixtures/simplefin/new-shape.json`, `tests/fixtures/simplefin/errlist-only.json`, `tests/unit/simplefin-schema.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type ErrItem = { code: string; msg: string; connId?: string; accountId?: string };
  export type NormalisedConnection = { id: string; name: string; domain?: string; url?: string; sfinUrl?: string; raw: unknown };
  export type NormalisedTransaction = { id: string; posted: number; transactedAt?: number; amountCents: number; description: string; payee?: string; memo?: string; pending: boolean; raw: unknown };
  export type NormalisedAccount = { id: string; connectionId: string; name: string; currency: string; balanceCents: number; availableBalanceCents?: number; balanceDate: number; transactions: NormalisedTransaction[]; raw: unknown };
  export type AccountSet = { connections: NormalisedConnection[]; accounts: NormalisedAccount[]; errlist: ErrItem[] };
  // schema.ts
  export class SimpleFinParseError extends Error
  export function parseAccountSet(json: unknown): AccountSet
  ```

- [ ] **Step 1: Write fixtures**

`tests/fixtures/simplefin/old-shape.json`:
```json
{
  "errors": ["Connection to Example Bank may need attention"],
  "accounts": [
    {
      "org": { "domain": "examplebank.com", "name": "Example Bank", "sfin-url": "https://bridge.example/simplefin", "url": "https://examplebank.com", "id": "org-1" },
      "id": "ACC-1",
      "name": "Everyday Chequing",
      "currency": "CAD",
      "balance": "1523.44",
      "available-balance": "1500.00",
      "balance-date": 1757400000,
      "transactions": [
        { "id": "TX-1", "posted": 1757300000, "amount": "-45.10", "description": "GROCERY MART", "payee": "Grocery Mart", "memo": "POS", "transaction_id": "bank-tx-1" },
        { "id": "TX-2", "posted": 0, "amount": "-12.00", "description": "PENDING COFFEE", "payee": "Coffee", "memo": "", "pending": true, "transacted_at": 1757390000 }
      ],
      "holdings": [],
      "extra": { "account-open-date": 1600000000 }
    },
    {
      "org": { "domain": "examplebank.com", "name": "Example Bank", "sfin-url": "https://bridge.example/simplefin", "url": "https://examplebank.com", "id": "org-1" },
      "id": "ACC-2",
      "name": "Visa",
      "currency": "CAD",
      "balance": "-820.15",
      "balance-date": 1757400000,
      "transactions": []
    }
  ]
}
```

`tests/fixtures/simplefin/new-shape.json`:
```json
{
  "errlist": [{ "code": "con.auth", "msg": "Please re-authenticate", "conn_id": "conn-9" }],
  "connections": [
    { "conn_id": "conn-9", "name": "New Bank", "org_id": "newbank", "org_url": "https://newbank.example", "sfin_url": "https://bridge.example/simplefin" }
  ],
  "accounts": [
    {
      "id": "ACC-9",
      "name": "Savings",
      "conn_id": "conn-9",
      "currency": "USD",
      "balance": "10000",
      "available-balance": "10000",
      "balance-date": 1757400000,
      "transactions": [
        { "id": "TX-9", "posted": 1757200000, "amount": "250.5", "description": "INTEREST", "transacted_at": 1757199000, "pending": false, "extra": { "category": "interest" } }
      ],
      "extra": { "apy": "4.1" }
    }
  ]
}
```

`tests/fixtures/simplefin/errlist-only.json`:
```json
{ "errlist": [{ "code": "gen.maint", "msg": "Down for maintenance" }], "connections": [], "accounts": [] }
```

- [ ] **Step 2: Write failing tests**

`tests/unit/simplefin-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseAccountSet, SimpleFinParseError } from "@/lib/simplefin/schema";

const load = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "simplefin", name), "utf8"));

describe("parseAccountSet old shape", () => {
  const set = parseAccountSet(load("old-shape.json"));
  it("derives one connection from org", () => {
    expect(set.connections).toHaveLength(1);
    expect(set.connections[0]).toMatchObject({ id: "org-1", name: "Example Bank", domain: "examplebank.com" });
  });
  it("normalises accounts with cents and connection id", () => {
    const acc = set.accounts.find((a) => a.id === "ACC-1")!;
    expect(acc).toMatchObject({ connectionId: "org-1", currency: "CAD", balanceCents: 152344, availableBalanceCents: 150000, balanceDate: 1757400000 });
    expect(set.accounts.find((a) => a.id === "ACC-2")!.balanceCents).toBe(-82015);
    expect(set.accounts.find((a) => a.id === "ACC-2")!.availableBalanceCents).toBeUndefined();
  });
  it("normalises transactions incl. payee, memo, pending", () => {
    const [t1, t2] = set.accounts[0].transactions;
    expect(t1).toMatchObject({ id: "TX-1", posted: 1757300000, amountCents: -4510, description: "GROCERY MART", payee: "Grocery Mart", memo: "POS", pending: false });
    expect(t2).toMatchObject({ id: "TX-2", posted: 0, pending: true, transactedAt: 1757390000 });
  });
  it("maps legacy string errors to gen.legacy", () => {
    expect(set.errlist).toEqual([{ code: "gen.legacy", msg: "Connection to Example Bank may need attention" }]);
  });
  it("preserves unknown fields in raw", () => {
    expect((set.accounts[0].raw as { extra: unknown }).extra).toEqual({ "account-open-date": 1600000000 });
    expect((set.accounts[0].transactions[0].raw as { transaction_id: string }).transaction_id).toBe("bank-tx-1");
  });
});

describe("parseAccountSet new shape", () => {
  const set = parseAccountSet(load("new-shape.json"));
  it("uses connections array", () => {
    expect(set.connections[0]).toMatchObject({ id: "conn-9", name: "New Bank", url: "https://newbank.example", sfinUrl: "https://bridge.example/simplefin" });
    expect(set.accounts[0].connectionId).toBe("conn-9");
  });
  it("keeps structured errlist", () => {
    expect(set.errlist).toEqual([{ code: "con.auth", msg: "Please re-authenticate", connId: "conn-9" }]);
  });
  it("parses amounts with one decimal", () => {
    expect(set.accounts[0].transactions[0].amountCents).toBe(25050);
    expect(set.accounts[0].balanceCents).toBe(1000000);
  });
});

describe("parseAccountSet edge cases", () => {
  it("handles errlist-only responses", () => {
    const set = parseAccountSet(load("errlist-only.json"));
    expect(set.accounts).toEqual([]);
    expect(set.errlist[0].code).toBe("gen.maint");
  });
  it("treats posted 0 as pending even without the flag", () => {
    const set = parseAccountSet({ accounts: [{ id: "A", name: "n", currency: "CAD", balance: "0", "balance-date": 1, org: { name: "o" }, transactions: [{ id: "T", posted: 0, amount: "1", description: "d" }] }] });
    expect(set.accounts[0].transactions[0].pending).toBe(true);
  });
  it("synthesises a connection id for an org without id", () => {
    const set = parseAccountSet({ accounts: [{ id: "A", name: "n", currency: "CAD", balance: "0", "balance-date": 1, org: { name: "Bank", domain: "bank.example" }, transactions: [] }] });
    expect(set.connections[0].id).toBe("bank.example");
    expect(set.accounts[0].connectionId).toBe("bank.example");
  });
  it("throws SimpleFinParseError on nonsense", () => {
    expect(() => parseAccountSet({ accounts: "nope" })).toThrow(SimpleFinParseError);
    expect(() => parseAccountSet(null)).toThrow(SimpleFinParseError);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/simplefin-schema.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement types and schema**

`src/lib/simplefin/types.ts`:
```ts
export type ErrItem = { code: string; msg: string; connId?: string; accountId?: string };

export type NormalisedConnection = {
  id: string;
  name: string;
  domain?: string;
  url?: string;
  sfinUrl?: string;
  raw: unknown;
};

export type NormalisedTransaction = {
  id: string;
  posted: number;
  transactedAt?: number;
  amountCents: number;
  description: string;
  payee?: string;
  memo?: string;
  pending: boolean;
  raw: unknown;
};

export type NormalisedAccount = {
  id: string;
  connectionId: string;
  name: string;
  currency: string;
  balanceCents: number;
  availableBalanceCents?: number;
  balanceDate: number;
  transactions: NormalisedTransaction[];
  raw: unknown;
};

export type AccountSet = {
  connections: NormalisedConnection[];
  accounts: NormalisedAccount[];
  errlist: ErrItem[];
};
```

`src/lib/simplefin/schema.ts`:
```ts
import { z } from "zod";
import { parseAmountToCents } from "../money";
import type { AccountSet, ErrItem, NormalisedAccount, NormalisedConnection, NormalisedTransaction } from "./types";

export class SimpleFinParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimpleFinParseError";
  }
}

const amount = z.union([z.string(), z.number()]);
const unixSeconds = z.number().int();

const wireTransaction = z
  .object({
    id: z.string(),
    posted: unixSeconds,
    amount,
    description: z.string().default(""),
    payee: z.string().optional(),
    memo: z.string().optional(),
    pending: z.boolean().optional(),
    transacted_at: unixSeconds.optional(),
  })
  .loose();

const wireOrg = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    domain: z.string().optional(),
    url: z.string().optional(),
    "sfin-url": z.string().optional(),
  })
  .loose();

const wireAccount = z
  .object({
    id: z.string(),
    name: z.string(),
    currency: z.string(),
    balance: amount,
    "available-balance": amount.optional(),
    "balance-date": unixSeconds,
    transactions: z.array(wireTransaction).default([]),
    org: wireOrg.optional(),
    conn_id: z.string().optional(),
  })
  .loose();

const wireConnection = z
  .object({
    conn_id: z.string(),
    name: z.string(),
    org_id: z.string().optional(),
    org_url: z.string().optional(),
    sfin_url: z.string().optional(),
  })
  .loose();

const wireErrItem = z
  .object({ code: z.string(), msg: z.string(), conn_id: z.string().optional(), account_id: z.string().optional() })
  .loose();

const wireAccountSet = z
  .object({
    errors: z.array(z.string()).optional(),
    errlist: z.array(wireErrItem).optional(),
    connections: z.array(wireConnection).optional(),
    accounts: z.array(wireAccount).default([]),
  })
  .loose();

function orgConnectionId(org: z.infer<typeof wireOrg>): string {
  return org.id ?? org["sfin-url"] ?? org.domain ?? org.name ?? "unknown";
}

export function parseAccountSet(json: unknown): AccountSet {
  const parsed = wireAccountSet.safeParse(json);
  if (!parsed.success) {
    throw new SimpleFinParseError(`Unrecognised SimpleFin response: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const wire = parsed.data;

  const connections = new Map<string, NormalisedConnection>();
  for (const c of wire.connections ?? []) {
    connections.set(c.conn_id, { id: c.conn_id, name: c.name, url: c.org_url, sfinUrl: c.sfin_url, raw: c });
  }

  const accounts: NormalisedAccount[] = wire.accounts.map((a) => {
    let connectionId: string;
    if (a.conn_id) {
      connectionId = a.conn_id;
      if (!connections.has(connectionId)) {
        connections.set(connectionId, { id: connectionId, name: connectionId, raw: {} });
      }
    } else {
      const org = a.org ?? {};
      connectionId = orgConnectionId(org);
      if (!connections.has(connectionId)) {
        connections.set(connectionId, {
          id: connectionId,
          name: org.name ?? connectionId,
          domain: org.domain,
          url: org.url,
          sfinUrl: org["sfin-url"],
          raw: org,
        });
      }
    }

    const transactions: NormalisedTransaction[] = a.transactions.map((t) => ({
      id: t.id,
      posted: t.posted,
      transactedAt: t.transacted_at,
      amountCents: parseAmountToCents(t.amount),
      description: t.description,
      payee: t.payee,
      memo: t.memo,
      pending: t.pending ?? t.posted === 0,
      raw: t,
    }));

    return {
      id: a.id,
      connectionId,
      name: a.name,
      currency: a.currency,
      balanceCents: parseAmountToCents(a.balance),
      availableBalanceCents: a["available-balance"] === undefined ? undefined : parseAmountToCents(a["available-balance"]),
      balanceDate: a["balance-date"],
      transactions,
      raw: a,
    };
  });

  const errlist: ErrItem[] = [
    ...(wire.errors ?? []).map((msg) => ({ code: "gen.legacy", msg })),
    ...(wire.errlist ?? []).map((e) => {
      const item: ErrItem = { code: e.code, msg: e.msg };
      if (e.conn_id) item.connId = e.conn_id;
      if (e.account_id) item.accountId = e.account_id;
      return item;
    }),
  ];

  return { connections: [...connections.values()], accounts, errlist };
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: pass. `toEqual` on errlist requires no `undefined` keys, which is why `connId`/`accountId` are only set when present.

- [ ] **Step 6: Commit**

```bash
git add src/lib/simplefin/types.ts src/lib/simplefin/schema.ts tests/fixtures tests/unit/simplefin-schema.test.ts
git commit -m "feat(simplefin): lenient parser for both wire shapes with normalised types

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: SimpleFin HTTP client and claim

**Files:**
- Create: `src/lib/simplefin/client.ts`, `src/lib/simplefin/claim.ts`, `tests/helpers/fetch.ts`, `tests/unit/simplefin-client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class SimpleFinAuthError extends Error {}       // 403
  export class SimpleFinPaymentError extends Error {}    // 402
  export class SimpleFinHttpError extends Error { status: number; body: string }
  export class SimpleFinNetworkError extends Error { cause: unknown }
  export type FetchAccountsOptions = { start: number; end: number; pending?: boolean; accountIds?: string[]; fetchImpl?: typeof fetch };
  export type FetchAccountsResult = { accountSet: AccountSet; rawBody: string; httpStatus: number };
  export function buildAccountsRequest(accessUrl: string, opts: FetchAccountsOptions): { url: string; headers: Record<string, string> };
  export async function fetchAccounts(accessUrl: string, opts: FetchAccountsOptions): Promise<FetchAccountsResult>;
  export async function claimSetupToken(token: string, fetchImpl?: typeof fetch): Promise<string>;
  // tests/helpers/fetch.ts
  export function makeFetchMock(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch & { calls: { url: string; init?: RequestInit }[] };
  ```

- [ ] **Step 1: Write the fetch mock helper**

`tests/helpers/fetch.ts`:
```ts
export type FetchCall = { url: string; init?: RequestInit };

export function makeFetchMock(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch & { calls: FetchCall[] };
  fn.calls = calls;
  return fn;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 2: Write failing tests**

`tests/unit/simplefin-client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildAccountsRequest, fetchAccounts, SimpleFinAuthError, SimpleFinPaymentError, SimpleFinHttpError, SimpleFinNetworkError } from "@/lib/simplefin/client";
import { claimSetupToken } from "@/lib/simplefin/claim";
import { SimpleFinParseError } from "@/lib/simplefin/schema";
import { makeFetchMock, jsonResponse } from "../helpers/fetch";

const ACCESS = "https://alice:s3cret@bridge.example/simplefin";

describe("buildAccountsRequest", () => {
  it("strips userinfo, adds basic auth and query params", () => {
    const { url, headers } = buildAccountsRequest(ACCESS, { start: 100, end: 200, pending: true, accountIds: ["A", "B"] });
    const u = new URL(url);
    expect(u.username).toBe("");
    expect(u.origin + u.pathname).toBe("https://bridge.example/simplefin/accounts");
    expect(u.searchParams.get("start-date")).toBe("100");
    expect(u.searchParams.get("end-date")).toBe("200");
    expect(u.searchParams.get("pending")).toBe("1");
    expect(u.searchParams.getAll("account")).toEqual(["A", "B"]);
    expect(headers.Authorization).toBe("Basic " + Buffer.from("alice:s3cret").toString("base64"));
    expect(headers.Accept).toBe("application/json");
  });
  it("omits pending when false", () => {
    const { url } = buildAccountsRequest(ACCESS, { start: 1, end: 2, pending: false });
    expect(new URL(url).searchParams.has("pending")).toBe(false);
  });
});

describe("fetchAccounts", () => {
  it("returns parsed set, raw body and status", async () => {
    const body = { errlist: [], connections: [], accounts: [] };
    const fetchImpl = makeFetchMock(() => jsonResponse(body));
    const res = await fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl });
    expect(res.httpStatus).toBe(200);
    expect(res.rawBody).toBe(JSON.stringify(body));
    expect(res.accountSet.accounts).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(1);
  });
  it("maps 403 to SimpleFinAuthError", async () => {
    const fetchImpl = makeFetchMock(() => new Response("forbidden", { status: 403 }));
    await expect(fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl })).rejects.toBeInstanceOf(SimpleFinAuthError);
  });
  it("maps 402 to SimpleFinPaymentError", async () => {
    const fetchImpl = makeFetchMock(() => new Response("pay", { status: 402 }));
    await expect(fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl })).rejects.toBeInstanceOf(SimpleFinPaymentError);
  });
  it("maps other statuses to SimpleFinHttpError with status", async () => {
    const fetchImpl = makeFetchMock(() => new Response("boom", { status: 500 }));
    const err = await fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(SimpleFinHttpError);
    expect((err as SimpleFinHttpError).status).toBe(500);
    expect((err as SimpleFinHttpError).body).toBe("boom");
  });
  it("wraps network failures", async () => {
    const fetchImpl = makeFetchMock(() => { throw new TypeError("fetch failed"); });
    await expect(fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl })).rejects.toBeInstanceOf(SimpleFinNetworkError);
  });
  it("throws SimpleFinParseError on invalid JSON", async () => {
    const fetchImpl = makeFetchMock(() => new Response("<html>", { status: 200 }));
    await expect(fetchAccounts(ACCESS, { start: 1, end: 2, fetchImpl })).rejects.toBeInstanceOf(SimpleFinParseError);
  });
});

describe("claimSetupToken", () => {
  it("decodes base64, POSTs with empty body, returns trimmed access url", async () => {
    const claimUrl = "https://bridge.example/simplefin/claim/DEMO";
    const token = Buffer.from(claimUrl).toString("base64");
    const fetchImpl = makeFetchMock(() => new Response("https://u:p@bridge.example/simplefin\n", { status: 200 }));
    const access = await claimSetupToken(token, fetchImpl);
    expect(access).toBe("https://u:p@bridge.example/simplefin");
    expect(fetchImpl.calls[0].url).toBe(claimUrl);
    expect(fetchImpl.calls[0].init?.method).toBe("POST");
    expect((fetchImpl.calls[0].init?.headers as Record<string, string>)["Content-Length"]).toBe("0");
  });
  it("throws SimpleFinAuthError on 403 (already claimed)", async () => {
    const token = Buffer.from("https://bridge.example/claim/X").toString("base64");
    const fetchImpl = makeFetchMock(() => new Response("", { status: 403 }));
    await expect(claimSetupToken(token, fetchImpl)).rejects.toBeInstanceOf(SimpleFinAuthError);
  });
  it("rejects a token that does not decode to a URL", async () => {
    await expect(claimSetupToken("!!!notbase64!!!")).rejects.toThrow(/setup token/i);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/simplefin-client.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement client and claim**

`src/lib/simplefin/client.ts`:
```ts
import { parseAccountSet, SimpleFinParseError } from "./schema";
import type { AccountSet } from "./types";

export class SimpleFinAuthError extends Error {
  constructor(message = "SimpleFin rejected the credentials (HTTP 403). The access URL may be revoked or the setup token already claimed.") {
    super(message);
    this.name = "SimpleFinAuthError";
  }
}
export class SimpleFinPaymentError extends Error {
  constructor() {
    super("SimpleFin Bridge returned HTTP 402: payment required. Check your bridge subscription.");
    this.name = "SimpleFinPaymentError";
  }
}
export class SimpleFinHttpError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`SimpleFin returned HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "SimpleFinHttpError";
  }
}
export class SimpleFinNetworkError extends Error {
  constructor(public readonly cause: unknown) {
    super(`Network error talking to SimpleFin: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "SimpleFinNetworkError";
  }
}

export type FetchAccountsOptions = {
  start: number;
  end: number;
  pending?: boolean;
  accountIds?: string[];
  fetchImpl?: typeof fetch;
};

export type FetchAccountsResult = { accountSet: AccountSet; rawBody: string; httpStatus: number };

export function splitAccessUrl(accessUrl: string): { baseUrl: string; authHeader: string } {
  const u = new URL(accessUrl);
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  u.username = "";
  u.password = "";
  const base = u.toString().replace(/\/$/, "");
  return { baseUrl: base, authHeader: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") };
}

export function buildAccountsRequest(accessUrl: string, opts: FetchAccountsOptions): { url: string; headers: Record<string, string> } {
  const { baseUrl, authHeader } = splitAccessUrl(accessUrl);
  const u = new URL(`${baseUrl}/accounts`);
  u.searchParams.set("start-date", String(Math.floor(opts.start)));
  u.searchParams.set("end-date", String(Math.floor(opts.end)));
  if (opts.pending ?? true) u.searchParams.set("pending", "1");
  for (const id of opts.accountIds ?? []) u.searchParams.append("account", id);
  return { url: u.toString(), headers: { Authorization: authHeader, Accept: "application/json" } };
}

export async function fetchAccounts(accessUrl: string, opts: FetchAccountsOptions): Promise<FetchAccountsResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { url, headers } = buildAccountsRequest(accessUrl, opts);
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", headers });
  } catch (cause) {
    throw new SimpleFinNetworkError(cause);
  }
  const rawBody = await res.text();
  if (res.status === 403) throw new SimpleFinAuthError();
  if (res.status === 402) throw new SimpleFinPaymentError();
  if (!res.ok) throw new SimpleFinHttpError(res.status, rawBody);
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new SimpleFinParseError(`Response was not JSON: ${rawBody.slice(0, 120)}`);
  }
  return { accountSet: parseAccountSet(json), rawBody, httpStatus: res.status };
}
```

`src/lib/simplefin/claim.ts`:
```ts
import { SimpleFinAuthError, SimpleFinHttpError, SimpleFinNetworkError } from "./client";

export async function claimSetupToken(token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(token.trim(), "base64").toString("utf8").trim();
    new URL(claimUrl);
  } catch {
    throw new Error("The setup token did not decode to a URL. Copy it again from SimpleFin Bridge.");
  }
  let res: Response;
  try {
    res = await fetchImpl(claimUrl, { method: "POST", headers: { "Content-Length": "0" } });
  } catch (cause) {
    throw new SimpleFinNetworkError(cause);
  }
  const body = (await res.text()).trim();
  if (res.status === 403) throw new SimpleFinAuthError("Claim rejected (HTTP 403): the setup token does not exist or was already claimed.");
  if (!res.ok) throw new SimpleFinHttpError(res.status, body);
  return body;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: pass. If `URL` rejects setting `username = ""` in Node 24, build the base URL from `protocol + "//" + host + pathname` instead.

- [ ] **Step 6: Commit**

```bash
git add src/lib/simplefin/client.ts src/lib/simplefin/claim.ts tests/helpers/fetch.ts tests/unit/simplefin-client.test.ts
git commit -m "feat(simplefin): http client with typed errors and setup-token claim

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Sync windows

**Files:**
- Create: `src/lib/sync/windows.ts`, `tests/unit/windows.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SyncWindow = { start: number; end: number };   // Unix seconds, end exclusive
  export const DAY = 86400; MAX_WINDOW_SECONDS = 90 * DAY; OVERLAP_SECONDS = 5 * DAY;
  export function computeWindows(lastSuccessEnd: number | null, now: number, backfillDays: number): SyncWindow[];
  ```

- [ ] **Step 1: Write failing tests**

`tests/unit/windows.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeWindows, DAY, MAX_WINDOW_SECONDS, OVERLAP_SECONDS } from "@/lib/sync/windows";

const NOW = 1_757_400_000;

describe("computeWindows", () => {
  it("backfills in <=90 day chunks with 5 day overlap, oldest first, ending at now", () => {
    const w = computeWindows(null, NOW, 365);
    expect(w[0].start).toBe(NOW - 365 * DAY);
    expect(w.at(-1)!.end).toBe(NOW);
    for (const win of w) expect(win.end - win.start).toBeLessThanOrEqual(MAX_WINDOW_SECONDS);
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBe(w[i - 1].end - OVERLAP_SECONDS);
    expect(w.length).toBe(5);
  });
  it("returns one window when backfill fits in 90 days", () => {
    expect(computeWindows(null, NOW, 30)).toEqual([{ start: NOW - 30 * DAY, end: NOW }]);
  });
  it("incremental sync starts 5 days before last success", () => {
    const last = NOW - 6 * 3600;
    expect(computeWindows(last, NOW, 365)).toEqual([{ start: last - OVERLAP_SECONDS, end: NOW }]);
  });
  it("splits a long gap into chunks", () => {
    const last = NOW - 200 * DAY;
    const w = computeWindows(last, NOW, 365);
    expect(w[0].start).toBe(last - OVERLAP_SECONDS);
    expect(w.at(-1)!.end).toBe(NOW);
    expect(w.length).toBe(3);
  });
  it("handles exactly 90 days", () => {
    const w = computeWindows(null, NOW, 90);
    expect(w).toEqual([{ start: NOW - 90 * DAY, end: NOW }]);
  });
  it("never returns an empty or inverted window", () => {
    const w = computeWindows(NOW, NOW, 365);
    expect(w).toEqual([{ start: NOW - OVERLAP_SECONDS, end: NOW }]);
    expect(computeWindows(null, NOW, 0)).toEqual([{ start: NOW - OVERLAP_SECONDS, end: NOW }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/windows.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/sync/windows.ts`:
```ts
export type SyncWindow = { start: number; end: number };

export const DAY = 86400;
export const MAX_WINDOW_SECONDS = 90 * DAY;
export const OVERLAP_SECONDS = 5 * DAY;

export function computeWindows(lastSuccessEnd: number | null, now: number, backfillDays: number): SyncWindow[] {
  const rangeStart = lastSuccessEnd === null ? now - backfillDays * DAY : lastSuccessEnd - OVERLAP_SECONDS;
  const start0 = Math.min(rangeStart, now - OVERLAP_SECONDS);
  const windows: SyncWindow[] = [];
  let start = start0;
  while (true) {
    const end = Math.min(start + MAX_WINDOW_SECONDS, now);
    windows.push({ start, end });
    if (end >= now) break;
    start = end - OVERLAP_SECONDS;
  }
  return windows;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: pass. For the 365-day case the chunk count is: 85-day net steps after the first 90 → ceil((365-90)/85)+1 = 5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/windows.ts tests/unit/windows.test.ts
git commit -m "feat(sync): compute 90-day windows with 5-day overlap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Sync engine

**Files:**
- Create: `src/lib/sync/engine.ts`, `tests/integration/sync-engine.test.ts`

**Interfaces:**
- Consumes: `computeWindows`, `fetchAccounts` + error classes, `Db`, `getState/setState/deleteState`, `STATE_KEYS`, `nowIso`, schema tables.
- Produces:
  ```ts
  export type SyncTrigger = "scheduled" | "manual" | "cli";
  export type SyncRunSummary = { runId: number; status: "success" | "partial" | "failed"; windowStart: number; windowEnd: number; accountsSeen: number; transactionsUpserted: number; pendingRemoved: number; errlist: ErrItem[]; error?: string };
  export type SyncSkipReason = "credentials_invalid" | "rate_limited" | "no_access_url";
  export type SyncResult = { skipped?: SyncSkipReason; runs: SyncRunSummary[] };
  export type SyncDeps = { db: Db; accessUrl?: string; backfillDays: number; fetchImpl?: typeof fetch; now?: () => number /* ms */ };
  export const RATE_GUARD_SECONDS = 30 * 60;
  export type CredentialsInvalidState = { reason: string; accessUrlHash: string; at: string };
  export function hashAccessUrl(url: string): string;
  export async function runSync(deps: SyncDeps, opts: { trigger: SyncTrigger; force?: boolean }): Promise<SyncResult>;
  ```

- [ ] **Step 1: Write failing integration tests**

`tests/integration/sync-engine.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { makeFetchMock, jsonResponse } from "../helpers/fetch";
import { runSync, RATE_GUARD_SECONDS } from "@/lib/sync/engine";
import { accounts, transactions, balanceSnapshots, syncRuns, connections } from "@/lib/db/schema";
import { getState, STATE_KEYS } from "@/lib/db/appState";
import { DAY } from "@/lib/sync/windows";

const ACCESS = "https://u:p@bridge.example/simplefin";
const NOW_MS = 1_757_400_000_000;
const fixture = (n: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "simplefin", n), "utf8"));

function deps(db = makeTestDb(), handler = () => jsonResponse(fixture("old-shape.json")), nowMs = NOW_MS) {
  const fetchImpl = makeFetchMock(handler);
  return { db, fetchImpl, d: { db, accessUrl: ACCESS, backfillDays: 365, fetchImpl, now: () => nowMs } };
}

describe("runSync first backfill", () => {
  it("issues one request per window and stores everything", async () => {
    const { db, fetchImpl, d } = deps();
    const result = await runSync(d, { trigger: "cli" });
    expect(result.skipped).toBeUndefined();
    expect(result.runs).toHaveLength(5);
    expect(fetchImpl.calls).toHaveLength(5);
    expect(result.runs.every((r) => r.status === "partial")).toBe(true); // fixture has a legacy error
    expect(db.select().from(connections).all()).toHaveLength(1);
    expect(db.select().from(accounts).all()).toHaveLength(2);
    expect(db.select().from(transactions).all()).toHaveLength(2);
    expect(db.select().from(balanceSnapshots).all()).toHaveLength(10); // 2 accounts x 5 runs
    const runs = db.select().from(syncRuns).all();
    expect(runs).toHaveLength(5);
    expect(runs[0].rawResponse).toContain("Everyday Chequing");
    expect(JSON.parse(runs[0].errlist)[0].code).toBe("gen.legacy");
    expect(getState<number>(db, STATE_KEYS.lastSuccessfulSyncEnd)).toBe(Math.floor(NOW_MS / 1000));
    const first = new URL(fetchImpl.calls[0].url);
    expect(Number(first.searchParams.get("start-date"))).toBe(Math.floor(NOW_MS / 1000) - 365 * DAY);
  });
  it("returns no_access_url when unset", async () => {
    const { d } = deps();
    const r = await runSync({ ...d, accessUrl: undefined }, { trigger: "cli" });
    expect(r.skipped).toBe("no_access_url");
    expect(r.runs).toEqual([]);
  });
});

describe("runSync incremental", () => {
  it("makes one request from last success minus overlap and updates pending -> posted in place", async () => {
    const { db, d } = deps();
    await runSync(d, { trigger: "cli" });
    const later = NOW_MS + 6 * 3600 * 1000;
    const updated = fixture("old-shape.json");
    updated.accounts[0].transactions[1] = { id: "TX-2", posted: 1757395000, amount: "-12.00", description: "COFFEE", payee: "Coffee", memo: "" };
    updated.accounts[0].balance = "1511.44";
    const fetchImpl = makeFetchMock(() => jsonResponse(updated));
    const r = await runSync({ ...d, fetchImpl, now: () => later }, { trigger: "scheduled" });
    expect(r.runs).toHaveLength(1);
    expect(fetchImpl.calls).toHaveLength(1);
    const u = new URL(fetchImpl.calls[0].url);
    expect(Number(u.searchParams.get("start-date"))).toBe(Math.floor(NOW_MS / 1000) - 5 * DAY);
    const tx2 = db.select().from(transactions).where(eq(transactions.id, "TX-2")).get()!;
    expect(tx2.pending).toBe(false);
    expect(tx2.posted).toBe(1757395000);
    expect(db.select().from(accounts).where(eq(accounts.id, "ACC-1")).get()!.balanceCents).toBe(151144);
    expect(db.select().from(transactions).all()).toHaveLength(2);
  });
  it("preserves user-set account fields across syncs", async () => {
    const { db, d } = deps();
    await runSync(d, { trigger: "cli" });
    db.update(accounts).set({ nickname: "Main", type: "checking", hidden: true }).where(eq(accounts.id, "ACC-1")).run();
    await runSync({ ...d, now: () => NOW_MS + 7 * 3600 * 1000 }, { trigger: "cli" });
    const a = db.select().from(accounts).where(eq(accounts.id, "ACC-1")).get()!;
    expect(a.nickname).toBe("Main");
    expect(a.type).toBe("checking");
    expect(a.hidden).toBe(true);
  });
  it("deletes pending transactions that vanished", async () => {
    const { db, d } = deps();
    await runSync(d, { trigger: "cli" });
    const without = fixture("old-shape.json");
    without.accounts[0].transactions = [without.accounts[0].transactions[0]];
    const r = await runSync({ ...d, fetchImpl: makeFetchMock(() => jsonResponse(without)), now: () => NOW_MS + 7 * 3600 * 1000 }, { trigger: "cli" });
    expect(r.runs[0].pendingRemoved).toBe(1);
    expect(db.select().from(transactions).where(eq(transactions.id, "TX-2")).get()).toBeUndefined();
    expect(db.select().from(transactions).where(eq(transactions.id, "TX-1")).get()).toBeDefined();
  });
});

describe("runSync guards and failures", () => {
  it("skips when last run started under 30 minutes ago unless forced", async () => {
    const { d, fetchImpl } = deps();
    await runSync(d, { trigger: "cli" });
    const soon = NOW_MS + (RATE_GUARD_SECONDS - 60) * 1000;
    const r1 = await runSync({ ...d, now: () => soon }, { trigger: "scheduled" });
    expect(r1.skipped).toBe("rate_limited");
    const r2 = await runSync({ ...d, now: () => soon }, { trigger: "manual", force: true });
    expect(r2.skipped).toBeUndefined();
    expect(fetchImpl.calls.length).toBe(6);
  });
  it("marks run failed and sets credentials_invalid on 403, then skips until access url changes", async () => {
    const { db, d } = deps(makeTestDb(), () => new Response("no", { status: 403 }));
    const r = await runSync(d, { trigger: "cli" });
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].status).toBe("failed");
    expect(r.runs[0].error).toMatch(/403/);
    expect(getState(db, STATE_KEYS.credentialsInvalid)).toBeDefined();
    const r2 = await runSync({ ...d, now: () => NOW_MS + DAY * 1000 }, { trigger: "scheduled" });
    expect(r2.skipped).toBe("credentials_invalid");
    const r3 = await runSync({ ...d, accessUrl: "https://u:new@bridge.example/simplefin", fetchImpl: makeFetchMock(() => jsonResponse(fixture("new-shape.json"))), now: () => NOW_MS + DAY * 1000 }, { trigger: "scheduled" });
    expect(r3.skipped).toBeUndefined();
    expect(getState(db, STATE_KEYS.credentialsInvalid)).toBeUndefined();
  });
  it("records a failed run on network error and keeps going next time", async () => {
    let calls = 0;
    const { db, d } = deps(makeTestDb(), () => { calls++; if (calls === 1) throw new TypeError("fetch failed"); return jsonResponse(fixture("new-shape.json")); });
    const r = await runSync(d, { trigger: "cli" });
    expect(r.runs[0].status).toBe("failed");
    expect(r.runs).toHaveLength(1); // stops after first failure
    expect(getState(db, STATE_KEYS.lastSuccessfulSyncEnd)).toBeUndefined();
    const r2 = await runSync({ ...d, now: () => NOW_MS + 3600 * 1000 }, { trigger: "cli", force: true });
    expect(r2.runs.every((x) => r2.runs.length > 0 && x.status === "partial")).toBe(true); // new-shape has con.auth errlist
  });
  it("stores raw body even when parse fails", async () => {
    const { db, d } = deps(makeTestDb(), () => new Response("<html>nope</html>", { status: 200 }));
    const r = await runSync(d, { trigger: "cli" });
    expect(r.runs[0].status).toBe("failed");
    expect(db.select().from(syncRuns).all()[0].rawResponse).toContain("<html>");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/sync-engine.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the engine**

`src/lib/sync/engine.ts`:
```ts
import { createHash } from "node:crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { nowIso } from "../db/client";
import { accounts, balanceSnapshots, connections, syncRuns, transactions } from "../db/schema";
import { deleteState, getState, setState, STATE_KEYS } from "../db/appState";
import { fetchAccounts, SimpleFinAuthError } from "../simplefin/client";
import type { AccountSet, ErrItem } from "../simplefin/types";
import { computeWindows, type SyncWindow } from "./windows";

export type SyncTrigger = "scheduled" | "manual" | "cli";
export type SyncRunSummary = {
  runId: number;
  status: "success" | "partial" | "failed";
  windowStart: number;
  windowEnd: number;
  accountsSeen: number;
  transactionsUpserted: number;
  pendingRemoved: number;
  errlist: ErrItem[];
  error?: string;
};
export type SyncSkipReason = "credentials_invalid" | "rate_limited" | "no_access_url";
export type SyncResult = { skipped?: SyncSkipReason; runs: SyncRunSummary[] };
export type SyncDeps = {
  db: Db;
  accessUrl?: string;
  backfillDays: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};
export type CredentialsInvalidState = { reason: string; accessUrlHash: string; at: string };

export const RATE_GUARD_SECONDS = 30 * 60;

export function hashAccessUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

export async function runSync(deps: SyncDeps, opts: { trigger: SyncTrigger; force?: boolean }): Promise<SyncResult> {
  const { db } = deps;
  const nowMs = (deps.now ?? Date.now)();
  const nowSec = Math.floor(nowMs / 1000);
  const force = opts.force ?? false;

  if (!deps.accessUrl) return { skipped: "no_access_url", runs: [] };
  const accessUrl = deps.accessUrl;
  const urlHash = hashAccessUrl(accessUrl);

  const invalid = getState<CredentialsInvalidState>(db, STATE_KEYS.credentialsInvalid);
  if (invalid) {
    if (invalid.accessUrlHash !== urlHash) deleteState(db, STATE_KEYS.credentialsInvalid);
    else if (!force) return { skipped: "credentials_invalid", runs: [] };
  }

  const lastRun = db.select({ startedAt: syncRuns.startedAt }).from(syncRuns).orderBy(sql`${syncRuns.id} desc`).limit(1).get();
  if (!force && lastRun && nowMs - Date.parse(lastRun.startedAt) < RATE_GUARD_SECONDS * 1000) {
    return { skipped: "rate_limited", runs: [] };
  }

  const lastSuccessEnd = getState<number>(db, STATE_KEYS.lastSuccessfulSyncEnd) ?? null;
  const windows = computeWindows(lastSuccessEnd, nowSec, deps.backfillDays);
  const runs: SyncRunSummary[] = [];

  for (const window of windows) {
    const summary = await syncWindow(deps, accessUrl, urlHash, window, opts.trigger, nowMs);
    runs.push(summary);
    if (summary.status === "failed") break;
  }
  return { runs };
}

async function syncWindow(deps: SyncDeps, accessUrl: string, urlHash: string, window: SyncWindow, trigger: SyncTrigger, nowMs: number): Promise<SyncRunSummary> {
  const { db } = deps;
  const startedAt = isoFromMs(nowMs);
  const run = db
    .insert(syncRuns)
    .values({ trigger, status: "running", startedAt, windowStart: window.start, windowEnd: window.end })
    .returning({ id: syncRuns.id })
    .get();

  const base = { runId: run.id, windowStart: window.start, windowEnd: window.end, accountsSeen: 0, transactionsUpserted: 0, pendingRemoved: 0, errlist: [] as ErrItem[] };

  let accountSet: AccountSet;
  let rawBody: string | undefined;
  let httpStatus: number | undefined;
  try {
    const res = await fetchAccounts(accessUrl, { start: window.start, end: window.end, pending: true, fetchImpl: deps.fetchImpl });
    accountSet = res.accountSet;
    rawBody = res.rawBody;
    httpStatus = res.httpStatus;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof SimpleFinAuthError) {
      setState(db, STATE_KEYS.credentialsInvalid, { reason: message, accessUrlHash: urlHash, at: nowIso() } satisfies CredentialsInvalidState);
    }
    const raw = (err as { rawBody?: string }).rawBody;
    db.update(syncRuns)
      .set({ status: "failed", finishedAt: nowIso(), error: message, rawResponse: raw, httpStatus: (err as { status?: number }).status })
      .where(eq(syncRuns.id, run.id))
      .run();
    return { ...base, status: "failed", error: message };
  }

  const stamp = nowIso();
  const result = db.transaction((tx) => {
    for (const c of accountSet.connections) {
      tx.insert(connections)
        .values({ id: c.id, name: c.name, domain: c.domain, url: c.url, sfinUrl: c.sfinUrl, raw: JSON.stringify(c.raw), firstSeenAt: stamp, lastSeenAt: stamp })
        .onConflictDoUpdate({ target: connections.id, set: { name: c.name, domain: c.domain, url: c.url, sfinUrl: c.sfinUrl, raw: JSON.stringify(c.raw), lastSeenAt: stamp } })
        .run();
    }

    let upserted = 0;
    let removed = 0;
    for (const a of accountSet.accounts) {
      tx.insert(accounts)
        .values({ id: a.id, connectionId: a.connectionId, name: a.name, currency: a.currency, balanceCents: a.balanceCents, availableBalanceCents: a.availableBalanceCents ?? null, balanceDate: a.balanceDate, raw: JSON.stringify(a.raw), firstSeenAt: stamp, lastSeenAt: stamp })
        .onConflictDoUpdate({ target: accounts.id, set: { connectionId: a.connectionId, name: a.name, currency: a.currency, balanceCents: a.balanceCents, availableBalanceCents: a.availableBalanceCents ?? null, balanceDate: a.balanceDate, raw: JSON.stringify(a.raw), lastSeenAt: stamp } })
        .run();

      for (const t of a.transactions) {
        tx.insert(transactions)
          .values({ id: t.id, accountId: a.id, posted: t.posted, transactedAt: t.transactedAt ?? null, amountCents: t.amountCents, description: t.description, payee: t.payee ?? null, memo: t.memo ?? null, pending: t.pending, raw: JSON.stringify(t.raw), firstSeenAt: stamp, lastSeenAt: stamp })
          .onConflictDoUpdate({ target: transactions.id, set: { accountId: a.id, posted: t.posted, transactedAt: t.transactedAt ?? null, amountCents: t.amountCents, description: t.description, payee: t.payee ?? null, memo: t.memo ?? null, pending: t.pending, raw: JSON.stringify(t.raw), lastSeenAt: stamp } })
          .run();
        upserted++;
      }

      const seenIds = a.transactions.map((t) => t.id);
      const windowStartIso = new Date(window.start * 1000).toISOString();
      const inWindow = sql`((${transactions.transactedAt} is not null and ${transactions.transactedAt} >= ${window.start} and ${transactions.transactedAt} < ${window.end}) or (${transactions.transactedAt} is null and ${transactions.firstSeenAt} >= ${windowStartIso}))`;
      const where = seenIds.length
        ? and(eq(transactions.accountId, a.id), eq(transactions.pending, true), notInArray(transactions.id, seenIds), inWindow)
        : and(eq(transactions.accountId, a.id), eq(transactions.pending, true), inWindow);
      removed += tx.delete(transactions).where(where).run().changes;

      tx.insert(balanceSnapshots)
        .values({ accountId: a.id, syncRunId: run.id, balanceCents: a.balanceCents, availableBalanceCents: a.availableBalanceCents ?? null, balanceDate: a.balanceDate, recordedAt: stamp })
        .run();
    }

    const status = accountSet.errlist.length ? "partial" : "success";
    tx.update(syncRuns)
      .set({ status, finishedAt: stamp, httpStatus, accountsSeen: accountSet.accounts.length, transactionsUpserted: upserted, pendingRemoved: removed, errlist: JSON.stringify(accountSet.errlist), rawResponse: rawBody })
      .where(eq(syncRuns.id, run.id))
      .run();
    setState(tx as unknown as Db, STATE_KEYS.lastSuccessfulSyncEnd, window.end);
    return { status, upserted, removed } as const;
  });

  return { ...base, status: result.status, accountsSeen: accountSet.accounts.length, transactionsUpserted: result.upserted, pendingRemoved: result.removed, errlist: accountSet.errlist };
}
```
Also amend `src/lib/simplefin/client.ts`: attach the raw body to parse errors so the explorer can show it. In `fetchAccounts`, wrap the `parseAccountSet(json)` call and the JSON.parse in a try/catch that does `Object.assign(err, { rawBody })` before rethrowing:
```ts
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw Object.assign(new SimpleFinParseError(`Response was not JSON: ${rawBody.slice(0, 120)}`), { rawBody });
  }
  try {
    return { accountSet: parseAccountSet(json), rawBody, httpStatus: res.status };
  } catch (err) {
    throw Object.assign(err as Error, { rawBody });
  }
```
Note `inArray` is imported for future use; remove it if lint complains.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: pass. Common failures: `.returning().get()` requires drizzle ≥0.29 (fine); `db.transaction` callback must be synchronous with better-sqlite3 (it is); `notInArray` with an empty array throws, which is why the `seenIds.length` branch exists.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/engine.ts src/lib/simplefin/client.ts tests/integration/sync-engine.test.ts
git commit -m "feat(sync): windowed sync engine with upserts, pending reconciliation, snapshots, guards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Scheduler, instrumentation hook, and CLI scripts

**Files:**
- Create: `src/lib/sync/scheduler.ts`, `src/instrumentation.ts`, `scripts/claim.ts`, `scripts/sync.ts`, `tests/unit/scheduler.test.ts`

**Interfaces:**
- Consumes: `runSync`, `getDb`, `loadConfig`, `getState/setState`, `STATE_KEYS`.
- Produces:
  ```ts
  export type SchedulerDeps = { db: Db; config: Config; runSyncImpl?: typeof runSync; now?: () => number; setTimeoutImpl?: typeof setTimeout; log?: (msg: string) => void };
  export type SchedulerHandle = { stop(): void; nextRunAt(): number | null };
  export function computeNextRun(nowMs: number, intervalHours: number, minuteOffset: number): number;  // ms epoch
  export function startScheduler(deps: SchedulerDeps): SchedulerHandle | null;  // null when interval is 0 or already started (globalThis guard)
  ```

- [ ] **Step 1: Write failing tests**

`tests/unit/scheduler.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { computeNextRun, startScheduler } from "@/lib/sync/scheduler";
import { makeTestDb } from "../helpers/db";
import { loadConfig } from "@/lib/config";
import { getState, setState, STATE_KEYS } from "@/lib/db/appState";

describe("computeNextRun", () => {
  it("lands on the next interval boundary plus the minute offset", () => {
    const t = Date.UTC(2026, 8, 9, 13, 5, 0); // 13:05Z
    const next = computeNextRun(t, 6, 17);
    expect(new Date(next).toISOString()).toBe("2026-09-09T18:17:00.000Z");
  });
  it("skips to the following boundary when the offset already passed", () => {
    const t = Date.UTC(2026, 8, 9, 18, 30, 0);
    expect(new Date(computeNextRun(t, 6, 17)).toISOString()).toBe("2026-09-10T00:17:00.000Z");
  });
});

describe("startScheduler", () => {
  it("returns null when interval is 0", () => {
    const db = makeTestDb();
    expect(startScheduler({ db, config: loadConfig({ SYNC_INTERVAL_HOURS: "0" }) })).toBeNull();
  });
  it("runs immediately when last success is stale, persists a minute offset, and schedules the next run", async () => {
    vi.useFakeTimers();
    const db = makeTestDb();
    const runSyncImpl = vi.fn(async () => ({ runs: [] }));
    const nowMs = Date.UTC(2026, 8, 9, 13, 5, 0);
    const handle = startScheduler({ db, config: loadConfig({ SYNC_INTERVAL_HOURS: "6", SIMPLEFIN_ACCESS_URL: "https://u:p@h/simplefin" }), runSyncImpl, now: () => nowMs, log: () => {} });
    expect(handle).not.toBeNull();
    await vi.runOnlyPendingTimersAsync();
    expect(runSyncImpl).toHaveBeenCalledTimes(1);
    expect(runSyncImpl.mock.calls[0][1]).toEqual({ trigger: "scheduled" });
    const offset = getState<number>(db, STATE_KEYS.schedulerMinuteOffset)!;
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(60);
    expect(handle!.nextRunAt()).toBe(computeNextRun(nowMs, 6, offset));
    handle!.stop();
    vi.useRealTimers();
  });
  it("does not run immediately when last success is fresh", async () => {
    vi.useFakeTimers();
    const db = makeTestDb();
    const nowMs = Date.UTC(2026, 8, 9, 13, 5, 0);
    setState(db, STATE_KEYS.lastSuccessfulSyncEnd, Math.floor(nowMs / 1000) - 3600);
    const runSyncImpl = vi.fn(async () => ({ runs: [] }));
    const handle = startScheduler({ db, config: loadConfig({ SYNC_INTERVAL_HOURS: "6" }), runSyncImpl, now: () => nowMs, log: () => {} });
    await vi.runOnlyPendingTimersAsync();
    expect(runSyncImpl).not.toHaveBeenCalled();
    handle!.stop();
    vi.useRealTimers();
  });
  it("refuses to start twice", () => {
    const db = makeTestDb();
    const config = loadConfig({ SYNC_INTERVAL_HOURS: "6" });
    const h1 = startScheduler({ db, config, runSyncImpl: async () => ({ runs: [] }), log: () => {} });
    const h2 = startScheduler({ db, config, runSyncImpl: async () => ({ runs: [] }), log: () => {} });
    expect(h1).not.toBeNull();
    expect(h2).toBeNull();
    h1!.stop();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/scheduler.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement scheduler**

`src/lib/sync/scheduler.ts`:
```ts
import type { Db } from "../db/client";
import type { Config } from "../config";
import { getState, setState, STATE_KEYS } from "../db/appState";
import { runSync } from "./engine";

export type SchedulerDeps = {
  db: Db;
  config: Config;
  runSyncImpl?: typeof runSync;
  now?: () => number;
  log?: (msg: string) => void;
};
export type SchedulerHandle = { stop(): void; nextRunAt(): number | null };

const g = globalThis as unknown as { __fineantsScheduler?: SchedulerHandle };

export function computeNextRun(nowMs: number, intervalHours: number, minuteOffset: number): number {
  const intervalMs = intervalHours * 3600 * 1000;
  const offsetMs = minuteOffset * 60 * 1000;
  const boundary = Math.floor(nowMs / intervalMs) * intervalMs;
  let candidate = boundary + offsetMs;
  while (candidate <= nowMs) candidate += intervalMs;
  return candidate;
}

export function startScheduler(deps: SchedulerDeps): SchedulerHandle | null {
  const { db, config } = deps;
  const log = deps.log ?? ((m: string) => console.log(`[fineants scheduler] ${m}`));
  const now = deps.now ?? Date.now;
  const run = deps.runSyncImpl ?? runSync;
  if (config.syncIntervalHours <= 0) return null;
  if (g.__fineantsScheduler) return null;

  let offset = getState<number>(db, STATE_KEYS.schedulerMinuteOffset);
  if (offset === undefined) {
    offset = Math.floor(Math.random() * 60);
    setState(db, STATE_KEYS.schedulerMinuteOffset, offset);
  }

  let timer: NodeJS.Timeout | null = null;
  let next: number | null = null;
  let stopped = false;

  const execute = async (): Promise<void> => {
    try {
      const result = await run(
        { db, accessUrl: config.simplefinAccessUrl, backfillDays: config.backfillDays },
        { trigger: "scheduled" },
      );
      log(result.skipped ? `skipped: ${result.skipped}` : `completed ${result.runs.length} run(s): ${result.runs.map((r) => r.status).join(",")}`);
    } catch (err) {
      log(`sync threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const scheduleNext = (): void => {
    if (stopped) return;
    next = computeNextRun(now(), config.syncIntervalHours, offset!);
    timer = setTimeout(async () => {
      await execute();
      scheduleNext();
    }, next - now());
  };

  const lastEnd = getState<number>(db, STATE_KEYS.lastSuccessfulSyncEnd);
  const stale = lastEnd === undefined || now() / 1000 - lastEnd > config.syncIntervalHours * 3600;
  if (stale) {
    timer = setTimeout(async () => {
      await execute();
      scheduleNext();
    }, 0);
    next = now();
  } else {
    scheduleNext();
  }
  log(`started; interval ${config.syncIntervalHours}h at :${String(offset).padStart(2, "0")}, next ${next ? new Date(next).toISOString() : "n/a"}`);

  const handle: SchedulerHandle = {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (g.__fineantsScheduler === handle) delete g.__fineantsScheduler;
    },
    nextRunAt: () => next,
  };
  g.__fineantsScheduler = handle;
  return handle;
}
```
Note on the "runs immediately" test: after the immediate run, `scheduleNext()` recomputes `next` from the fake clock, so `nextRunAt()` equals `computeNextRun(nowMs, 6, offset)` as asserted.

- [ ] **Step 4: Write instrumentation and scripts**

`src/instrumentation.ts`:
```ts
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
```

`scripts/claim.ts`:
```ts
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
```

`scripts/sync.ts`:
```ts
import "dotenv/config";
import { loadConfig } from "../src/lib/config";
import { createDb } from "../src/lib/db/client";
import { runSync } from "../src/lib/sync/engine";

async function main() {
  const config = loadConfig();
  const force = process.argv.includes("--force");
  const db = createDb(config.databasePath);
  const result = await runSync({ db, accessUrl: config.simplefinAccessUrl, backfillDays: config.backfillDays }, { trigger: "cli", force });
  if (result.skipped) {
    console.log(`Skipped: ${result.skipped}${result.skipped === "rate_limited" ? " (use --force to override)" : ""}`);
    return;
  }
  for (const r of result.runs) {
    const w = `${new Date(r.windowStart * 1000).toISOString().slice(0, 10)}..${new Date(r.windowEnd * 1000).toISOString().slice(0, 10)}`;
    console.log(`run #${r.runId} ${r.status} ${w} accounts=${r.accountsSeen} tx=${r.transactionsUpserted} pendingRemoved=${r.pendingRemoved}${r.error ? ` error=${r.error}` : ""}`);
    for (const e of r.errlist) console.log(`  errlist ${e.code}: ${e.msg}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 5: Run tests, lint, and a real dry run**

Run: `npm test && npm run lint`
Expected: pass.
Run: `npm run sync`
Expected without `.env`: prints `Skipped: no_access_url`. With a real or demo access URL it prints run lines. To get a demo URL: `npm run claim -- <demo setup token from https://beta-bridge.simplefin.org/info/developers>`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sync/scheduler.ts src/instrumentation.ts scripts/claim.ts scripts/sync.ts tests/unit/scheduler.test.ts
git commit -m "feat(sync): interval scheduler via instrumentation hook, claim and sync CLIs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Query layer

**Files:**
- Create: `src/lib/queries/accounts.ts`, `src/lib/queries/balances.ts`, `src/lib/queries/transactions.ts`, `src/lib/queries/spending.ts`, `src/lib/queries/syncRuns.ts`, `tests/helpers/seed.ts`, `tests/integration/queries.test.ts`

**Interfaces:**
- Consumes: `Db`, schema tables, `getState`, `STATE_KEYS`.
- Produces (all synchronous, take `db` first):
  ```ts
  // accounts.ts
  export function listAccounts(db, opts?: { includeHidden?: boolean }): AccountRow[]           // ordered by connection name, name
  export function getAccount(db, id: string): AccountRow | undefined
  export function totalsByCurrency(db): { currency: string; balanceCents: number }[]            // non-hidden only
  export function updateAccountSettings(db, id, patch: { nickname?: string | null; type?: AccountType | null; hidden?: boolean }): void
  export function displayName(a: Pick<AccountRow, "nickname" | "name">): string
  // balances.ts
  export type SeriesPoint = { date: string /* YYYY-MM-DD */; balanceCents: number };
  export function accountBalanceSeries(db, accountId: string, days: number, nowMs?: number): SeriesPoint[]   // last snapshot per day
  export function netWorthSeries(db, days: number, nowMs?: number): { currency: string; points: SeriesPoint[] }[]  // per currency, non-hidden; carries forward each account's last known balance per day
  // transactions.ts
  export type TxFilter = { accountId?: string; q?: string; from?: string; to?: string; page?: number; pageSize?: number; includeHidden?: boolean };
  export type TxRow = TransactionRow & { accountName: string; currency: string; effectiveDate: number };
  export function listTransactions(db, f?: TxFilter): { rows: TxRow[]; total: number; page: number; pageSize: number }
  export function recentTransactions(db, limit: number): TxRow[]
  // spending.ts
  export type Granularity = "day" | "week" | "month";
  export type PeriodTotals = { period: string; currency: string; outflowCents: number; inflowCents: number };
  export function spendingByPeriod(db, opts: { days: number; granularity: Granularity; nowMs?: number }): PeriodTotals[]
  export function topPayees(db, opts: { days: number; limit?: number; nowMs?: number }): { label: string; currency: string; outflowCents: number; count: number }[]
  // syncRuns.ts
  export type SyncStatus = { latest: SyncRunRow | undefined; lastSuccessfulSyncEnd: number | undefined; credentialsInvalid: CredentialsInvalidState | undefined; latestErrlist: ErrItem[] };
  export function listSyncRuns(db, limit?: number): SyncRunRow[]
  export function getSyncRun(db, id: number): SyncRunRow | undefined
  export function getSyncStatus(db): SyncStatus
  ```
  "Effective date" of a transaction is `coalesce(nullif(posted,0), transacted_at, unixepoch(first_seen_at))` and is the basis for all date filtering and grouping. Outflow = negative amounts (as positive cents); inflow = positive amounts.

- [ ] **Step 1: Write a seed helper**

`tests/helpers/seed.ts`:
```ts
import type { Db } from "@/lib/db/client";
import { accounts, balanceSnapshots, connections, syncRuns, transactions } from "@/lib/db/schema";

export const T0 = Date.UTC(2026, 8, 9, 12, 0, 0); // 2026-09-09T12:00Z
const day = (n: number) => Math.floor(T0 / 1000) - n * 86400;
const iso = (n: number) => new Date(T0 - n * 86400 * 1000).toISOString();

export function seedBasic(db: Db) {
  db.insert(connections).values({ id: "org-1", name: "Example Bank", raw: "{}", firstSeenAt: iso(30), lastSeenAt: iso(0) }).run();
  db.insert(accounts).values([
    { id: "CHQ", connectionId: "org-1", name: "Chequing", currency: "CAD", balanceCents: 100000, balanceDate: day(0), raw: "{}", firstSeenAt: iso(30), lastSeenAt: iso(0) },
    { id: "VISA", connectionId: "org-1", name: "Visa", currency: "CAD", balanceCents: -50000, balanceDate: day(0), raw: "{}", type: "credit", firstSeenAt: iso(30), lastSeenAt: iso(0) },
    { id: "HIDDEN", connectionId: "org-1", name: "Old", currency: "CAD", balanceCents: 999, balanceDate: day(0), raw: "{}", hidden: true, firstSeenAt: iso(30), lastSeenAt: iso(0) },
    { id: "USD", connectionId: "org-1", name: "USD Savings", currency: "USD", balanceCents: 250000, balanceDate: day(0), raw: "{}", firstSeenAt: iso(30), lastSeenAt: iso(0) },
  ]).run();
  const tx = (id: string, accountId: string, n: number, amountCents: number, description: string, payee?: string, pending = false) => ({
    id, accountId, posted: pending ? 0 : day(n), transactedAt: pending ? day(n) : null, amountCents, description, payee: payee ?? null, memo: null, pending, raw: "{}", firstSeenAt: iso(n), lastSeenAt: iso(0),
  });
  db.insert(transactions).values([
    tx("t1", "CHQ", 1, -4510, "GROCERY MART", "Grocery Mart"),
    tx("t2", "CHQ", 2, -1200, "COFFEE", "Coffee"),
    tx("t3", "CHQ", 3, 250000, "PAYROLL", "Employer"),
    tx("t4", "VISA", 10, -8000, "GAS STATION", "Gas"),
    tx("t5", "VISA", 40, -30000, "OLD PURCHASE", "Old Shop"),
    tx("t6", "HIDDEN", 1, -99999, "SHOULD NOT COUNT"),
    tx("t7", "CHQ", 0, -500, "PENDING SNACK", "Snack", true),
    tx("t8", "USD", 5, -1000, "USD THING", "Usd Shop"),
  ]).run();
  const run = db.insert(syncRuns).values({ trigger: "cli", status: "success", startedAt: iso(0), finishedAt: iso(0), windowStart: day(90), windowEnd: day(0) }).returning({ id: syncRuns.id }).get();
  db.insert(balanceSnapshots).values([
    { accountId: "CHQ", syncRunId: run.id, balanceCents: 90000, balanceDate: day(2), recordedAt: iso(2) },
    { accountId: "CHQ", syncRunId: run.id, balanceCents: 95000, balanceDate: day(1), recordedAt: iso(1) },
    { accountId: "CHQ", syncRunId: run.id, balanceCents: 100000, balanceDate: day(0), recordedAt: iso(0) },
    { accountId: "VISA", syncRunId: run.id, balanceCents: -40000, balanceDate: day(2), recordedAt: iso(2) },
    { accountId: "VISA", syncRunId: run.id, balanceCents: -50000, balanceDate: day(0), recordedAt: iso(0) },
    { accountId: "HIDDEN", syncRunId: run.id, balanceCents: 999, balanceDate: day(0), recordedAt: iso(0) },
    { accountId: "USD", syncRunId: run.id, balanceCents: 250000, balanceDate: day(0), recordedAt: iso(0) },
  ]).run();
  return { runId: run.id };
}
```

- [ ] **Step 2: Write failing tests**

`tests/integration/queries.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic, T0 } from "../helpers/seed";
import type { Db } from "@/lib/db/client";
import { listAccounts, getAccount, totalsByCurrency, updateAccountSettings, displayName } from "@/lib/queries/accounts";
import { accountBalanceSeries, netWorthSeries } from "@/lib/queries/balances";
import { listTransactions, recentTransactions } from "@/lib/queries/transactions";
import { spendingByPeriod, topPayees } from "@/lib/queries/spending";
import { listSyncRuns, getSyncRun, getSyncStatus } from "@/lib/queries/syncRuns";
import { setState, STATE_KEYS } from "@/lib/db/appState";

let db: Db;
let runId: number;
beforeEach(() => {
  db = makeTestDb();
  runId = seedBasic(db).runId;
});

describe("accounts", () => {
  it("lists non-hidden by default and all when asked", () => {
    expect(listAccounts(db).map((a) => a.id)).toEqual(["CHQ", "USD", "VISA"]);
    expect(listAccounts(db, { includeHidden: true })).toHaveLength(4);
  });
  it("totals by currency exclude hidden", () => {
    expect(totalsByCurrency(db)).toEqual([{ currency: "CAD", balanceCents: 50000 }, { currency: "USD", balanceCents: 250000 }]);
  });
  it("updates settings and displayName prefers nickname", () => {
    updateAccountSettings(db, "CHQ", { nickname: "Main", type: "checking", hidden: false });
    const a = getAccount(db, "CHQ")!;
    expect(a.nickname).toBe("Main");
    expect(a.type).toBe("checking");
    expect(displayName(a)).toBe("Main");
    updateAccountSettings(db, "CHQ", { nickname: null });
    expect(displayName(getAccount(db, "CHQ")!)).toBe("Chequing");
  });
});

describe("balances", () => {
  it("returns one point per day for an account", () => {
    const s = accountBalanceSeries(db, "CHQ", 30, T0);
    expect(s).toEqual([
      { date: "2026-09-07", balanceCents: 90000 },
      { date: "2026-09-08", balanceCents: 95000 },
      { date: "2026-09-09", balanceCents: 100000 },
    ]);
  });
  it("net worth carries forward missing days and excludes hidden", () => {
    const series = netWorthSeries(db, 30, T0);
    const cad = series.find((s) => s.currency === "CAD")!;
    expect(cad.points).toEqual([
      { date: "2026-09-07", balanceCents: 50000 },
      { date: "2026-09-08", balanceCents: 55000 },
      { date: "2026-09-09", balanceCents: 50000 },
    ]);
    const usd = series.find((s) => s.currency === "USD")!;
    expect(usd.points).toEqual([{ date: "2026-09-09", balanceCents: 250000 }]);
  });
});

describe("transactions", () => {
  it("lists newest first with account info and effective date, excluding hidden", () => {
    const { rows, total } = listTransactions(db);
    expect(total).toBe(7);
    expect(rows[0].id).toBe("t7"); // pending today
    expect(rows[0].accountName).toBe("Chequing");
    expect(rows[0].currency).toBe("CAD");
    expect(rows.map((r) => r.id)).not.toContain("t6");
  });
  it("filters by account, text, and date range", () => {
    expect(listTransactions(db, { accountId: "VISA" }).rows.map((r) => r.id)).toEqual(["t4", "t5"]);
    expect(listTransactions(db, { q: "coffee" }).rows.map((r) => r.id)).toEqual(["t2"]);
    expect(listTransactions(db, { q: "Employer" }).rows.map((r) => r.id)).toEqual(["t3"]);
    expect(listTransactions(db, { from: "2026-09-06", to: "2026-09-08" }).rows.map((r) => r.id)).toEqual(["t2", "t3"]);
  });
  it("paginates", () => {
    const p1 = listTransactions(db, { page: 1, pageSize: 3 });
    const p2 = listTransactions(db, { page: 2, pageSize: 3 });
    expect(p1.rows).toHaveLength(3);
    expect(p2.rows).toHaveLength(3);
    expect(p1.rows[0].id).not.toBe(p2.rows[0].id);
    expect(p1.total).toBe(7);
  });
  it("recentTransactions limits", () => {
    expect(recentTransactions(db, 2)).toHaveLength(2);
  });
});

describe("spending", () => {
  it("groups by day with outflow and inflow, excluding hidden accounts", () => {
    const rows = spendingByPeriod(db, { days: 7, granularity: "day", nowMs: T0 });
    const cad = rows.filter((r) => r.currency === "CAD");
    expect(cad).toEqual([
      { period: "2026-09-06", currency: "CAD", outflowCents: 0, inflowCents: 250000 },
      { period: "2026-09-07", currency: "CAD", outflowCents: 1200, inflowCents: 0 },
      { period: "2026-09-08", currency: "CAD", outflowCents: 4510, inflowCents: 0 },
      { period: "2026-09-09", currency: "CAD", outflowCents: 500, inflowCents: 0 },
    ]);
    expect(rows.find((r) => r.currency === "USD")).toEqual({ period: "2026-09-04", currency: "USD", outflowCents: 1000, inflowCents: 0 });
  });
  it("groups by month", () => {
    const rows = spendingByPeriod(db, { days: 60, granularity: "month", nowMs: T0 }).filter((r) => r.currency === "CAD");
    expect(rows).toEqual([
      { period: "2026-07", currency: "CAD", outflowCents: 30000, inflowCents: 0 },
      { period: "2026-08", currency: "CAD", outflowCents: 8000, inflowCents: 0 },
      { period: "2026-09", currency: "CAD", outflowCents: 6210, inflowCents: 250000 },
    ]);
  });
  it("groups by ISO week", () => {
    const rows = spendingByPeriod(db, { days: 7, granularity: "week", nowMs: T0 }).filter((r) => r.currency === "CAD");
    expect(rows.map((r) => r.period)).toEqual(["2026-W36", "2026-W37"]);
  });
  it("ranks payees by outflow", () => {
    const top = topPayees(db, { days: 30, limit: 2, nowMs: T0 });
    expect(top[0]).toEqual({ label: "Gas", currency: "CAD", outflowCents: 8000, count: 1 });
    expect(top[1]).toEqual({ label: "Grocery Mart", currency: "CAD", outflowCents: 4510, count: 1 });
  });
});

describe("syncRuns", () => {
  it("lists and gets runs", () => {
    expect(listSyncRuns(db)).toHaveLength(1);
    expect(getSyncRun(db, runId)?.status).toBe("success");
    expect(getSyncRun(db, 999)).toBeUndefined();
  });
  it("reports status including credentials flag", () => {
    setState(db, STATE_KEYS.credentialsInvalid, { reason: "403", accessUrlHash: "x", at: "now" });
    setState(db, STATE_KEYS.lastSuccessfulSyncEnd, 123);
    const s = getSyncStatus(db);
    expect(s.latest?.id).toBe(runId);
    expect(s.lastSuccessfulSyncEnd).toBe(123);
    expect(s.credentialsInvalid?.reason).toBe("403");
    expect(s.latestErrlist).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/integration/queries.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement queries**

`src/lib/queries/accounts.ts`:
```ts
import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, connections, type AccountRow, type AccountType } from "../db/schema";

export function listAccounts(db: Db, opts: { includeHidden?: boolean } = {}): AccountRow[] {
  const q = db
    .select({ a: accounts })
    .from(accounts)
    .leftJoin(connections, eq(accounts.connectionId, connections.id))
    .orderBy(asc(connections.name), asc(accounts.name));
  const rows = opts.includeHidden ? q.all() : q.where(eq(accounts.hidden, false)).all();
  return rows.map((r) => r.a);
}

export function getAccount(db: Db, id: string): AccountRow | undefined {
  return db.select().from(accounts).where(eq(accounts.id, id)).get();
}

export function totalsByCurrency(db: Db): { currency: string; balanceCents: number }[] {
  return db
    .select({ currency: accounts.currency, balanceCents: sql<number>`sum(${accounts.balanceCents})`.mapWith(Number) })
    .from(accounts)
    .where(eq(accounts.hidden, false))
    .groupBy(accounts.currency)
    .orderBy(asc(accounts.currency))
    .all();
}

export function updateAccountSettings(db: Db, id: string, patch: { nickname?: string | null; type?: AccountType | null; hidden?: boolean }): void {
  const set: Partial<AccountRow> = {};
  if ("nickname" in patch) set.nickname = patch.nickname?.trim() ? patch.nickname.trim() : null;
  if ("type" in patch) set.type = patch.type ?? null;
  if ("hidden" in patch) set.hidden = patch.hidden ?? false;
  if (Object.keys(set).length === 0) return;
  db.update(accounts).set(set).where(eq(accounts.id, id)).run();
}

export function displayName(a: Pick<AccountRow, "nickname" | "name">): string {
  return a.nickname?.trim() || a.name;
}
```

`src/lib/queries/balances.ts`:
```ts
import { and, eq, gte, asc, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, balanceSnapshots } from "../db/schema";

export type SeriesPoint = { date: string; balanceCents: number };

const dayOf = (iso: string) => iso.slice(0, 10);

function sinceIso(days: number, nowMs: number): string {
  return new Date(nowMs - days * 86400 * 1000).toISOString();
}

export function accountBalanceSeries(db: Db, accountId: string, days: number, nowMs = Date.now()): SeriesPoint[] {
  const rows = db
    .select({ recordedAt: balanceSnapshots.recordedAt, balanceCents: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.accountId, accountId), gte(balanceSnapshots.recordedAt, sinceIso(days, nowMs))))
    .orderBy(asc(balanceSnapshots.recordedAt))
    .all();
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(dayOf(r.recordedAt), r.balanceCents); // last write per day wins
  return [...byDay.entries()].map(([date, balanceCents]) => ({ date, balanceCents }));
}

export function netWorthSeries(db: Db, days: number, nowMs = Date.now()): { currency: string; points: SeriesPoint[] }[] {
  const visible = db.select({ id: accounts.id, currency: accounts.currency }).from(accounts).where(eq(accounts.hidden, false)).all();
  if (visible.length === 0) return [];
  const currencyOf = new Map(visible.map((a) => [a.id, a.currency]));
  const rows = db
    .select({ accountId: balanceSnapshots.accountId, recordedAt: balanceSnapshots.recordedAt, balanceCents: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(inArray(balanceSnapshots.accountId, visible.map((a) => a.id)), gte(balanceSnapshots.recordedAt, sinceIso(days, nowMs))))
    .orderBy(asc(balanceSnapshots.recordedAt))
    .all();

  // per currency: per day, per account last balance; then carry forward
  const perCurrency = new Map<string, Map<string, Map<string, number>>>(); // currency -> day -> account -> balance
  for (const r of rows) {
    const cur = currencyOf.get(r.accountId)!;
    const days = perCurrency.get(cur) ?? new Map();
    perCurrency.set(cur, days);
    const day = dayOf(r.recordedAt);
    const accts = days.get(day) ?? new Map();
    days.set(day, accts);
    accts.set(r.accountId, r.balanceCents);
  }
  const out: { currency: string; points: SeriesPoint[] }[] = [];
  for (const [currency, daysMap] of [...perCurrency.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const carried = new Map<string, number>();
    const points: SeriesPoint[] = [];
    for (const day of [...daysMap.keys()].sort()) {
      for (const [acct, bal] of daysMap.get(day)!) carried.set(acct, bal);
      let total = 0;
      for (const bal of carried.values()) total += bal;
      points.push({ date: day, balanceCents: total });
    }
    out.push({ currency, points });
  }
  return out;
}
```

`src/lib/queries/transactions.ts`:
```ts
import { and, desc, eq, gte, like, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, transactions, type TransactionRow } from "../db/schema";

export type TxFilter = { accountId?: string; q?: string; from?: string; to?: string; page?: number; pageSize?: number; includeHidden?: boolean };
export type TxRow = TransactionRow & { accountName: string; currency: string; effectiveDate: number };

export const effectiveDate = sql<number>`coalesce(nullif(${transactions.posted}, 0), ${transactions.transactedAt}, unixepoch(${transactions.firstSeenAt}))`;

export function dateToUnix(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

function buildWhere(f: TxFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  if (!f.includeHidden) parts.push(eq(accounts.hidden, false));
  if (f.accountId) parts.push(eq(transactions.accountId, f.accountId));
  if (f.q?.trim()) {
    const pat = `%${f.q.trim()}%`;
    parts.push(or(like(transactions.description, pat), like(transactions.payee, pat), like(transactions.memo, pat)));
  }
  if (f.from) parts.push(gte(effectiveDate, dateToUnix(f.from)));
  if (f.to) parts.push(lt(effectiveDate, dateToUnix(f.to) + 86400));
  return and(...parts.filter(Boolean) as SQL[]);
}

export function listTransactions(db: Db, f: TxFilter = {}): { rows: TxRow[]; total: number; page: number; pageSize: number } {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, f.pageSize ?? 50));
  const where = buildWhere(f);
  const total = db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(where)
    .get()!.n;
  const rows = db
    .select({ t: transactions, accountName: sql<string>`coalesce(nullif(${accounts.nickname}, ''), ${accounts.name})`, currency: accounts.currency, effectiveDate })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(where)
    .orderBy(desc(effectiveDate), desc(transactions.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()
    .map((r) => ({ ...r.t, accountName: r.accountName, currency: r.currency, effectiveDate: r.effectiveDate }));
  return { rows, total, page, pageSize };
}

export function recentTransactions(db: Db, limit: number): TxRow[] {
  return listTransactions(db, { page: 1, pageSize: limit }).rows;
}
```

`src/lib/queries/spending.ts`:
```ts
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, transactions } from "../db/schema";
import { effectiveDate } from "./transactions";

export type Granularity = "day" | "week" | "month";
export type PeriodTotals = { period: string; currency: string; outflowCents: number; inflowCents: number };

function periodExpr(g: Granularity) {
  const ts = sql`datetime(${effectiveDate}, 'unixepoch')`;
  if (g === "day") return sql<string>`strftime('%Y-%m-%d', ${ts})`;
  if (g === "month") return sql<string>`strftime('%Y-%m', ${ts})`;
  // ISO week: SQLite 3.46+ supports %G-W%V; fall back computed in JS if unavailable
  return sql<string>`strftime('%G-W%V', ${ts})`;
}

const outflow = sql<number>`sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end)`.mapWith(Number);
const inflow = sql<number>`sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end)`.mapWith(Number);

export function spendingByPeriod(db: Db, opts: { days: number; granularity: Granularity; nowMs?: number }): PeriodTotals[] {
  const since = Math.floor((opts.nowMs ?? Date.now()) / 1000) - opts.days * 86400;
  const period = periodExpr(opts.granularity);
  return db
    .select({ period, currency: accounts.currency, outflowCents: outflow, inflowCents: inflow })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(accounts.hidden, false), gte(effectiveDate, since)))
    .groupBy(period, accounts.currency)
    .orderBy(accounts.currency, period)
    .all();
}

export function topPayees(db: Db, opts: { days: number; limit?: number; nowMs?: number }): { label: string; currency: string; outflowCents: number; count: number }[] {
  const since = Math.floor((opts.nowMs ?? Date.now()) / 1000) - opts.days * 86400;
  const label = sql<string>`coalesce(nullif(${transactions.payee}, ''), ${transactions.description})`;
  return db
    .select({ label, currency: accounts.currency, outflowCents: sql<number>`sum(-${transactions.amountCents})`.mapWith(Number), count: sql<number>`count(*)`.mapWith(Number) })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(accounts.hidden, false), gte(effectiveDate, since), sql`${transactions.amountCents} < 0`))
    .groupBy(label, accounts.currency)
    .orderBy(desc(sql`sum(-${transactions.amountCents})`))
    .limit(opts.limit ?? 10)
    .all();
}
```

`src/lib/queries/syncRuns.ts`:
```ts
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { syncRuns, type SyncRunRow } from "../db/schema";
import { getState, STATE_KEYS } from "../db/appState";
import type { CredentialsInvalidState } from "../sync/engine";
import type { ErrItem } from "../simplefin/types";

export type SyncStatus = {
  latest: SyncRunRow | undefined;
  lastSuccessfulSyncEnd: number | undefined;
  credentialsInvalid: CredentialsInvalidState | undefined;
  latestErrlist: ErrItem[];
};

export function listSyncRuns(db: Db, limit = 50): SyncRunRow[] {
  return db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(limit).all();
}

export function getSyncRun(db: Db, id: number): SyncRunRow | undefined {
  return db.select().from(syncRuns).where(eq(syncRuns.id, id)).get();
}

export function getSyncStatus(db: Db): SyncStatus {
  const latest = listSyncRuns(db, 1)[0];
  return {
    latest,
    lastSuccessfulSyncEnd: getState<number>(db, STATE_KEYS.lastSuccessfulSyncEnd),
    credentialsInvalid: getState<CredentialsInvalidState>(db, STATE_KEYS.credentialsInvalid),
    latestErrlist: latest ? (JSON.parse(latest.errlist) as ErrItem[]) : [],
  };
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: pass. If the ISO-week test fails because the bundled SQLite lacks `%G`/`%V`, check `SELECT sqlite_version()`; better-sqlite3 13 bundles ≥3.46 which supports them. If the netWorth 09-08 expectation confuses you: CHQ 95000 + VISA carried −40000 = 55000.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries tests/helpers/seed.ts tests/integration/queries.test.ts
git commit -m "feat(queries): accounts, balances, transactions, spending, and sync status queries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: API routes

**Files:**
- Create: `src/lib/api/auth.ts`, `src/app/api/sync/route.ts`, `src/app/api/v1/summary/route.ts`, `src/app/api/v1/spending/route.ts`, `tests/api/auth.test.ts`, `tests/api/routes.test.ts`

**Interfaces:**
- Consumes: `runSync`, `getDb`, `loadConfig`, queries.
- Produces:
  ```ts
  // auth.ts
  export type AuthResult = { ok: true; via: "api-key" | "same-origin" } | { ok: false; status: 401 | 503; message: string };
  export function authorise(req: Request, config: Config, opts?: { allowSameOrigin?: boolean }): AuthResult;
  export function unauthorised(r: Extract<AuthResult, { ok: false }>): Response;
  // routes take Request and read the db via getDb(); they also export `buildSummary(db)` and `buildSpending(db, range, nowMs?)` helpers from src/lib/api/summary.ts for testability
  ```
  Add `src/lib/api/summary.ts`:
  ```ts
  export type SummaryPayload = { generatedAt: string; lastSync: { finishedAt: string | null; status: string } | null; credentialsInvalid: boolean; totals: { currency: string; balanceCents: number }[]; accounts: { id: string; name: string; type: string | null; currency: string; balanceCents: number; balanceDate: number }[] };
  export function buildSummary(db: Db, nowMs?: number): SummaryPayload;
  export type SpendingRange = "today" | "7d" | "30d";
  export type SpendingPayload = { range: SpendingRange; days: PeriodTotals[]; topPayees: ReturnType<typeof topPayees> };
  export function buildSpending(db: Db, range: SpendingRange, nowMs?: number): SpendingPayload;
  ```

- [ ] **Step 1: Write failing tests**

`tests/api/auth.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { authorise } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";

const cfg = loadConfig({ API_KEY: "secret" });
const req = (headers: Record<string, string>) => new Request("http://localhost/api/x", { headers });

describe("authorise", () => {
  it("accepts a matching api key", () => {
    expect(authorise(req({ "x-api-key": "secret" }), cfg)).toEqual({ ok: true, via: "api-key" });
  });
  it("rejects a wrong or missing key", () => {
    expect(authorise(req({ "x-api-key": "nope" }), cfg).ok).toBe(false);
    expect(authorise(req({}), cfg).ok).toBe(false);
  });
  it("returns 503 when no API key is configured", () => {
    const r = authorise(req({ "x-api-key": "x" }), loadConfig({}));
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
  it("accepts same-origin only when allowed", () => {
    const so = req({ "sec-fetch-site": "same-origin" });
    expect(authorise(so, cfg, { allowSameOrigin: true })).toEqual({ ok: true, via: "same-origin" });
    expect(authorise(so, cfg).ok).toBe(false);
    expect(authorise(req({ "sec-fetch-site": "cross-site" }), cfg, { allowSameOrigin: true }).ok).toBe(false);
  });
});
```

`tests/api/routes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic, T0 } from "../helpers/seed";
import { buildSummary, buildSpending } from "@/lib/api/summary";

describe("buildSummary", () => {
  it("returns totals, visible accounts, and last sync", () => {
    const db = makeTestDb();
    seedBasic(db);
    const s = buildSummary(db, T0);
    expect(s.totals).toEqual([{ currency: "CAD", balanceCents: 50000 }, { currency: "USD", balanceCents: 250000 }]);
    expect(s.accounts.map((a) => a.id)).toEqual(["CHQ", "USD", "VISA"]);
    expect(s.accounts[2]).toMatchObject({ name: "Visa", type: "credit", balanceCents: -50000 });
    expect(s.lastSync?.status).toBe("success");
    expect(s.credentialsInvalid).toBe(false);
    expect(s.generatedAt).toBe(new Date(T0).toISOString());
  });
  it("handles an empty database", () => {
    const s = buildSummary(makeTestDb(), T0);
    expect(s).toMatchObject({ totals: [], accounts: [], lastSync: null });
  });
});

describe("buildSpending", () => {
  it("maps ranges to day windows", () => {
    const db = makeTestDb();
    seedBasic(db);
    expect(buildSpending(db, "today", T0).days.filter((d) => d.currency === "CAD")).toEqual([{ period: "2026-09-09", currency: "CAD", outflowCents: 500, inflowCents: 0 }]);
    expect(buildSpending(db, "7d", T0).days.filter((d) => d.currency === "CAD")).toHaveLength(4);
    expect(buildSpending(db, "30d", T0).topPayees[0].label).toBe("Gas");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api`
Expected: FAIL.

- [ ] **Step 3: Implement auth and summary helpers**

`src/lib/api/auth.ts`:
```ts
import { timingSafeEqual } from "node:crypto";
import type { Config } from "../config";

export type AuthResult =
  | { ok: true; via: "api-key" | "same-origin" }
  | { ok: false; status: 401 | 503; message: string };

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function authorise(req: Request, config: Config, opts: { allowSameOrigin?: boolean } = {}): AuthResult {
  if (opts.allowSameOrigin && req.headers.get("sec-fetch-site") === "same-origin") {
    return { ok: true, via: "same-origin" };
  }
  if (!config.apiKey) return { ok: false, status: 503, message: "API_KEY is not configured on the server" };
  const provided = req.headers.get("x-api-key");
  if (provided && safeEqual(provided, config.apiKey)) return { ok: true, via: "api-key" };
  return { ok: false, status: 401, message: "missing or invalid x-api-key" };
}

export function unauthorised(r: Extract<AuthResult, { ok: false }>): Response {
  return Response.json({ error: r.message }, { status: r.status });
}
```

`src/lib/api/summary.ts`:
```ts
import type { Db } from "../db/client";
import { listAccounts, totalsByCurrency, displayName } from "../queries/accounts";
import { getSyncStatus } from "../queries/syncRuns";
import { spendingByPeriod, topPayees, type PeriodTotals } from "../queries/spending";

export type SummaryPayload = {
  generatedAt: string;
  lastSync: { finishedAt: string | null; status: string } | null;
  credentialsInvalid: boolean;
  totals: { currency: string; balanceCents: number }[];
  accounts: { id: string; name: string; type: string | null; currency: string; balanceCents: number; balanceDate: number }[];
};

export function buildSummary(db: Db, nowMs = Date.now()): SummaryPayload {
  const status = getSyncStatus(db);
  return {
    generatedAt: new Date(nowMs).toISOString(),
    lastSync: status.latest ? { finishedAt: status.latest.finishedAt, status: status.latest.status } : null,
    credentialsInvalid: Boolean(status.credentialsInvalid),
    totals: totalsByCurrency(db),
    accounts: listAccounts(db).map((a) => ({ id: a.id, name: displayName(a), type: a.type, currency: a.currency, balanceCents: a.balanceCents, balanceDate: a.balanceDate })),
  };
}

export type SpendingRange = "today" | "7d" | "30d";
export const SPENDING_RANGES: SpendingRange[] = ["today", "7d", "30d"];
export type SpendingPayload = { range: SpendingRange; days: PeriodTotals[]; topPayees: ReturnType<typeof topPayees> };

export function buildSpending(db: Db, range: SpendingRange, nowMs = Date.now()): SpendingPayload {
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const nowSec = Math.floor(nowMs / 1000);
  const rows = spendingByPeriod(db, { days, granularity: "day", nowMs });
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const filtered = range === "today" ? rows.filter((r) => r.period === todayStr) : rows;
  void nowSec;
  return { range, days: filtered, topPayees: topPayees(db, { days, limit: 10, nowMs }) };
}
```
(Remove the `nowSec` lines if lint flags them; they are not needed.)

- [ ] **Step 4: Implement the route handlers**

`src/app/api/sync/route.ts`:
```ts
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { authorise, unauthorised } from "@/lib/api/auth";
import { runSync } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const config = loadConfig();
  const auth = authorise(req, config, { allowSameOrigin: true });
  if (!auth.ok) return unauthorised(auth);
  const force = new URL(req.url).searchParams.get("force") === "1";
  const result = await runSync({ db: getDb(), accessUrl: config.simplefinAccessUrl, backfillDays: config.backfillDays }, { trigger: "manual", force });
  if (result.skipped === "rate_limited") return Response.json(result, { status: 409 });
  if (result.skipped === "credentials_invalid" || result.skipped === "no_access_url") return Response.json(result, { status: 503 });
  return Response.json(result);
}
```

`src/app/api/v1/summary/route.ts`:
```ts
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { authorise, unauthorised } from "@/lib/api/auth";
import { buildSummary } from "@/lib/api/summary";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = authorise(req, loadConfig());
  if (!auth.ok) return unauthorised(auth);
  return Response.json(buildSummary(getDb()));
}
```

`src/app/api/v1/spending/route.ts`:
```ts
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { authorise, unauthorised } from "@/lib/api/auth";
import { buildSpending, SPENDING_RANGES, type SpendingRange } from "@/lib/api/summary";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = authorise(req, loadConfig());
  if (!auth.ok) return unauthorised(auth);
  const range = new URL(req.url).searchParams.get("range") ?? "7d";
  if (!SPENDING_RANGES.includes(range as SpendingRange)) {
    return Response.json({ error: `range must be one of ${SPENDING_RANGES.join(", ")}` }, { status: 400 });
  }
  return Response.json(buildSpending(getDb(), range as SpendingRange));
}
```

- [ ] **Step 5: Run tests, lint, and a manual curl**

Run: `npm test && npm run lint`
Expected: pass.
Run: `API_KEY=k npm run dev` in one terminal, then:
```bash
curl -s -H 'x-api-key: k' localhost:3000/api/v1/summary | head -c 300; echo
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/v1/summary   # 401
curl -s -X POST -H 'x-api-key: k' localhost:3000/api/v1/../sync          # 503 no_access_url without SIMPLEFIN_ACCESS_URL
```
Expected: JSON summary; 401; `{"skipped":"no_access_url","runs":[]}`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api src/app/api tests/api
git commit -m "feat(api): api-key auth, manual sync endpoint, summary and spending JSON

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: App shell, shared components, and Overview page

**Files:**
- Create: `src/lib/format.ts`, `src/components/Nav.tsx`, `src/components/Amount.tsx`, `src/components/EmptyState.tsx`, `src/components/ErrorBanner.tsx`, `src/components/SyncButton.tsx`, `src/components/charts/NetWorthChart.tsx`, `tests/unit/format.test.ts`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Delete: any create-next-app placeholder assets in `public/` and `src/app/page.module.css` if present.

**Interfaces:**
- Consumes: queries from Task 10, `getSyncStatus`, `formatCents`.
- Produces:
  ```ts
  // format.ts (server-safe, no React)
  export function unixToDate(sec: number): string;          // "2026-09-09"
  export function isoToLocal(iso: string | null): string;   // "2026-09-09 13:05" (UTC-based, deterministic) or "—"
  export function relativeFromNow(iso: string | null, nowMs?: number): string; // "3 min ago", "2 h ago", "5 d ago", "never"
  // components
  <Nav />                                  // links: Overview, Transactions, Spending, Explorer, Settings
  <Amount cents currency />                // colours negative red-ish, positive default; tabular-nums
  <EmptyState title children />            // dashed box with guidance
  <ErrorBanner status={SyncStatus} />      // renders nothing when no problems
  <SyncButton />                           // client; POST /api/sync same-origin; shows result; router.refresh()
  <NetWorthChart series={{currency, points}[]} />  // client, Recharts LineChart, one line per currency
  ```

- [ ] **Step 1: Write format tests**

`tests/unit/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { unixToDate, isoToLocal, relativeFromNow } from "@/lib/format";

describe("format", () => {
  it("unixToDate", () => {
    expect(unixToDate(1757400000)).toBe("2026-09-09");
  });
  it("isoToLocal", () => {
    expect(isoToLocal("2026-09-09T13:05:00.000Z")).toBe("2026-09-09 13:05");
    expect(isoToLocal(null)).toBe("—");
  });
  it("relativeFromNow", () => {
    const now = Date.parse("2026-09-09T13:05:00Z");
    expect(relativeFromNow(null, now)).toBe("never");
    expect(relativeFromNow("2026-09-09T13:04:30Z", now)).toBe("just now");
    expect(relativeFromNow("2026-09-09T13:02:00Z", now)).toBe("3 min ago");
    expect(relativeFromNow("2026-09-09T11:05:00Z", now)).toBe("2 h ago");
    expect(relativeFromNow("2026-09-04T13:05:00Z", now)).toBe("5 d ago");
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement format.ts**

Run: `npx vitest run tests/unit/format.test.ts` → FAIL.

`src/lib/format.ts`:
```ts
export function unixToDate(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

export function isoToLocal(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

export function relativeFromNow(iso: string | null, nowMs = Date.now()): string {
  if (!iso) return "never";
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
```
Run: `npm test` → pass.

- [ ] **Step 3: Global styles and layout**

Replace `src/app/globals.css` with:
```css
@import "tailwindcss";

:root {
  --bg: #fafaf9;
  --fg: #1c1917;
  --muted: #78716c;
  --card: #ffffff;
  --border: #e7e5e4;
  --neg: #b91c1c;
  --pos: #15803d;
  --accent: #0f766e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0c0a09;
    --fg: #f5f5f4;
    --muted: #a8a29e;
    --card: #1c1917;
    --border: #292524;
    --neg: #f87171;
    --pos: #4ade80;
    --accent: #2dd4bf;
  }
}
html, body { background: var(--bg); color: var(--fg); }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem; }
.muted { color: var(--muted); }
.tnum { font-variant-numeric: tabular-nums; }
.neg { color: var(--neg); }
.pos { color: var(--pos); }
a.nav-active { color: var(--accent); font-weight: 600; }
table.data { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
table.data th, table.data td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); text-align: left; }
table.data th { color: var(--muted); font-weight: 500; }
table.data td.num, table.data th.num { text-align: right; }
.btn { border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.375rem 0.75rem; background: var(--card); font-size: 0.875rem; }
.btn:hover { border-color: var(--accent); }
.btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
input, select { border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.375rem 0.5rem; background: var(--card); color: var(--fg); font-size: 0.875rem; }
pre.json { font-size: 0.75rem; overflow-x: auto; background: var(--card); border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.75rem; }
```

`src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = { title: "fineants", description: "Personal finance dashboard" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <Nav />
          <main className="mt-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Shared components**

`src/components/Nav.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/", "Overview"],
  ["/transactions", "Transactions"],
  ["/spending", "Spending"],
  ["/explorer", "Explorer"],
  ["/settings", "Settings"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border)" }}>
      <Link href="/" className="text-xl font-semibold tracking-tight">fineants</Link>
      <nav className="flex gap-4 text-sm">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className={path === href || (href !== "/" && path.startsWith(href)) ? "nav-active" : "muted"}>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
```

`src/components/Amount.tsx`:
```tsx
import { formatCents } from "@/lib/money";

export function Amount({ cents, currency, signColour = true }: { cents: number; currency: string; signColour?: boolean }) {
  const cls = signColour ? (cents < 0 ? "neg" : cents > 0 ? "pos" : "") : "";
  return <span className={`tnum ${cls}`}>{formatCents(cents, currency)}</span>;
}
```

`src/components/EmptyState.tsx`:
```tsx
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--border)" }}>
      <p className="font-medium">{title}</p>
      {children ? <div className="muted mt-2 text-sm">{children}</div> : null}
    </div>
  );
}
```

`src/components/ErrorBanner.tsx`:
```tsx
import Link from "next/link";
import type { SyncStatus } from "@/lib/queries/syncRuns";

export function ErrorBanner({ status }: { status: SyncStatus }) {
  const items: React.ReactNode[] = [];
  if (status.credentialsInvalid) {
    items.push(<li key="cred">SimpleFin rejected the access URL (HTTP 403). Scheduled syncs are paused until <code>SIMPLEFIN_ACCESS_URL</code> changes. {status.credentialsInvalid.reason}</li>);
  }
  if (status.latest?.status === "failed" && status.latest.error) {
    items.push(<li key="failed">Last sync failed: {status.latest.error}</li>);
  }
  for (const e of status.latestErrlist) {
    items.push(<li key={`${e.code}-${e.connId ?? ""}-${e.msg}`}><code>{e.code}</code> {e.msg}{e.connId ? ` (connection ${e.connId})` : ""}</li>);
  }
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--neg)" }}>
      <p className="font-medium">SimpleFin reported problems</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">{items}</ul>
      <p className="muted mt-2">Details in the <Link href="/explorer" className="underline">explorer</Link>. Connection errors usually mean re-authenticating the bank at SimpleFin Bridge.</p>
    </div>
  );
}
```

`src/components/SyncButton.tsx`:
```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type SyncResponse = { skipped?: string; runs: { status: string; transactionsUpserted: number }[]; error?: string };

export function SyncButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const trigger = (force: boolean) =>
    start(async () => {
      setMsg(null);
      try {
        const res = await fetch(`/api/sync${force ? "?force=1" : ""}`, { method: "POST" });
        const body = (await res.json()) as SyncResponse;
        if (body.skipped === "rate_limited") setMsg("Synced recently. Hold ⇧ and click to force.");
        else if (body.skipped) setMsg(`Skipped: ${body.skipped}`);
        else if (body.error) setMsg(body.error);
        else setMsg(`${body.runs.length} run(s): ${body.runs.map((r) => r.status).join(", ")}; ${body.runs.reduce((n, r) => n + r.transactionsUpserted, 0)} transactions`);
        router.refresh();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      }
    });

  return (
    <div className="flex items-center gap-3">
      <button className="btn btn-primary" disabled={pending} onClick={(e) => trigger(e.shiftKey)} title="Shift-click to force">
        {pending ? "Syncing…" : "Sync now"}
      </button>
      {msg ? <span className="muted text-sm">{msg}</span> : null}
    </div>
  );
}
```

`src/components/charts/NetWorthChart.tsx`:
```tsx
"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatCents } from "@/lib/money";

type Series = { currency: string; points: { date: string; balanceCents: number }[] };
const COLOURS = ["#0f766e", "#b45309", "#6d28d9", "#be123c"];

export function NetWorthChart({ series }: { series: Series[] }) {
  if (series.length === 0 || series.every((s) => s.points.length === 0)) return <p className="muted text-sm">No balance history yet.</p>;
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const data = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const s of series) {
      const p = s.points.find((x) => x.date === date);
      if (p) row[s.currency] = p.balanceCents / 100;
    }
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
        <YAxis tick={{ fontSize: 11 }} width={64} tickFormatter={(v: number) => v.toLocaleString()} />
        <Tooltip formatter={(v, name) => [formatCents(Math.round(Number(v) * 100), String(name)), String(name)]} />
        {series.map((s, i) => (
          <Line key={s.currency} type="monotone" dataKey={s.currency} stroke={COLOURS[i % COLOURS.length]} dot={false} strokeWidth={2} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 5: Overview page**

`src/app/page.tsx`:
```tsx
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listAccounts, totalsByCurrency, displayName } from "@/lib/queries/accounts";
import { netWorthSeries } from "@/lib/queries/balances";
import { recentTransactions } from "@/lib/queries/transactions";
import { getSyncStatus } from "@/lib/queries/syncRuns";
import { unixToDate, relativeFromNow, isoToLocal } from "@/lib/format";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SyncButton } from "@/components/SyncButton";
import { NetWorthChart } from "@/components/charts/NetWorthChart";

export const dynamic = "force-dynamic";

export default function OverviewPage() {
  const db = getDb();
  const status = getSyncStatus(db);
  const accounts = listAccounts(db);
  const totals = totalsByCurrency(db);
  const series = netWorthSeries(db, 365);
  const recent = recentTransactions(db, 20);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="muted text-sm">
            Last sync: {status.latest ? `${status.latest.status} · ${relativeFromNow(status.latest.finishedAt ?? status.latest.startedAt)} (${isoToLocal(status.latest.finishedAt)})` : "never"}
          </p>
        </div>
        <SyncButton />
      </section>

      <ErrorBanner status={status} />

      {accounts.length === 0 ? (
        <EmptyState title="No accounts yet">
          Set <code>SIMPLEFIN_ACCESS_URL</code> in <code>.env</code> (run <code>npm run claim</code> with your setup token first), then click Sync now. Check the <Link href="/explorer" className="underline">explorer</Link> for raw responses.
        </EmptyState>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {totals.map((t) => (
              <div key={t.currency} className="card">
                <p className="muted text-xs uppercase tracking-wide">Net {t.currency}</p>
                <p className="mt-1 text-2xl font-semibold"><Amount cents={t.balanceCents} currency={t.currency} /></p>
              </div>
            ))}
          </section>

          <section className="card">
            <h2 className="mb-2 font-medium">Net worth over time</h2>
            <NetWorthChart series={series} />
          </section>

          <section>
            <h2 className="mb-2 font-medium">Accounts</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((a) => (
                <Link key={a.id} href={`/accounts/${encodeURIComponent(a.id)}`} className="card block hover:opacity-90">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium">{displayName(a)}</p>
                    <span className="muted text-xs">{a.type ?? "unclassified"}</span>
                  </div>
                  <p className="mt-2 text-xl"><Amount cents={a.balanceCents} currency={a.currency} /></p>
                  <p className="muted text-xs">as of {unixToDate(a.balanceDate)}{a.availableBalanceCents !== null ? <> · available <Amount cents={a.availableBalanceCents} currency={a.currency} signColour={false} /></> : null}</p>
                </Link>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-medium">Recent transactions</h2>
              <Link href="/transactions" className="muted text-sm underline">All transactions</Link>
            </div>
            <table className="data">
              <thead><tr><th>Date</th><th>Account</th><th>Description</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap">{unixToDate(t.effectiveDate)}{t.pending ? <span className="muted"> · pending</span> : null}</td>
                    <td>{t.accountName}</td>
                    <td>{t.payee || t.description}</td>
                    <td className="num"><Amount cents={t.amountCents} currency={t.currency} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify in the browser**

Run: `rm -f src/app/page.module.css public/*.svg; npm run lint && npm run build && npm run dev`
Open http://localhost:3000. Expected with an empty DB: header, Sync now button, "No accounts yet" empty state, no console errors. With a synced DB (`npm run sync` using a demo access URL): totals, chart, account cards, recent transactions.

- [ ] **Step 7: Commit**

```bash
git add -A src public tests/unit/format.test.ts
git commit -m "feat(ui): app shell, shared components, overview dashboard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Transactions page and account detail page

**Files:**
- Create: `src/app/transactions/page.tsx`, `src/components/TransactionsTable.tsx`, `src/components/TransactionFilters.tsx`, `src/app/accounts/[id]/page.tsx`, `src/components/charts/BalanceChart.tsx`

**Interfaces:**
- Consumes: `listTransactions`, `listAccounts`, `getAccount`, `accountBalanceSeries`, `TxRow`, `TxFilter`.
- Produces:
  ```tsx
  <TransactionsTable rows={TxRow[]} showAccount?: boolean />
  <TransactionFilters accounts={AccountRow[]} current={TxFilter} basePath={string} hideAccountSelect?: boolean />  // GET form; preserves other params
  <Pagination page total pageSize basePath params />  // exported from TransactionsTable.tsx
  <BalanceChart points={SeriesPoint[]} currency />
  ```
  URL params for `/transactions`: `account`, `q`, `from`, `to`, `page`. Account page uses the same minus `account`.

- [ ] **Step 1: Filters and table components**

`src/components/TransactionFilters.tsx`:
```tsx
import type { AccountRow } from "@/lib/db/schema";
import type { TxFilter } from "@/lib/queries/transactions";
import { displayName } from "@/lib/queries/accounts";

export function TransactionFilters({ accounts, current, basePath, hideAccountSelect = false }: { accounts: AccountRow[]; current: TxFilter; basePath: string; hideAccountSelect?: boolean }) {
  return (
    <form action={basePath} method="get" className="flex flex-wrap items-end gap-3 text-sm">
      {!hideAccountSelect ? (
        <label className="flex flex-col gap-1">
          <span className="muted text-xs">Account</span>
          <select name="account" defaultValue={current.accountId ?? ""}>
            <option value="">All</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{displayName(a)}</option>)}
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="muted text-xs">Search</span>
        <input name="q" defaultValue={current.q ?? ""} placeholder="description, payee, memo" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="muted text-xs">From</span>
        <input type="date" name="from" defaultValue={current.from ?? ""} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="muted text-xs">To</span>
        <input type="date" name="to" defaultValue={current.to ?? ""} />
      </label>
      <button className="btn" type="submit">Filter</button>
      <a className="btn" href={basePath}>Reset</a>
    </form>
  );
}
```

`src/components/TransactionsTable.tsx`:
```tsx
import Link from "next/link";
import type { TxRow } from "@/lib/queries/transactions";
import { Amount } from "./Amount";
import { unixToDate } from "@/lib/format";

export function TransactionsTable({ rows, showAccount = true }: { rows: TxRow[]; showAccount?: boolean }) {
  if (rows.length === 0) return <p className="muted text-sm">No transactions match.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="data">
        <thead>
          <tr>
            <th>Date</th>
            {showAccount ? <th>Account</th> : null}
            <th>Payee</th>
            <th>Description</th>
            <th>Memo</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="whitespace-nowrap">{unixToDate(t.effectiveDate)}{t.pending ? <span className="muted"> · pending</span> : null}</td>
              {showAccount ? <td><Link href={`/accounts/${encodeURIComponent(t.accountId)}`} className="underline-offset-2 hover:underline">{t.accountName}</Link></td> : null}
              <td>{t.payee ?? ""}</td>
              <td>{t.description}</td>
              <td className="muted">{t.memo ?? ""}</td>
              <td className="num"><Amount cents={t.amountCents} currency={t.currency} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, total, pageSize, basePath, params }: { page: number; total: number; pageSize: number; basePath: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="muted">{total} transactions · page {page} of {pages}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="btn" href={href(page - 1)}>Previous</Link> : null}
        {page < pages ? <Link className="btn" href={href(page + 1)}>Next</Link> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Transactions page**

`src/app/transactions/page.tsx`:
```tsx
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/queries/accounts";
import { listTransactions, type TxFilter } from "@/lib/queries/transactions";
import { TransactionFilters } from "@/components/TransactionFilters";
import { TransactionsTable, Pagination } from "@/components/TransactionsTable";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export function filterFromParams(sp: SP): TxFilter {
  return { accountId: one(sp.account), q: one(sp.q), from: one(sp.from), to: one(sp.to), page: Number(one(sp.page) ?? 1) || 1, pageSize: 50 };
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const db = getDb();
  const filter = filterFromParams(sp);
  const accounts = listAccounts(db, { includeHidden: true });
  const { rows, total, page, pageSize } = listTransactions(db, { ...filter, includeHidden: Boolean(filter.accountId) });
  const params = { account: filter.accountId, q: filter.q, from: filter.from, to: filter.to };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Transactions</h1>
      <TransactionFilters accounts={accounts} current={filter} basePath="/transactions" />
      <TransactionsTable rows={rows} />
      <Pagination page={page} total={total} pageSize={pageSize} basePath="/transactions" params={params} />
    </div>
  );
}
```
Note: hidden accounts are excluded from "All" but shown when explicitly selected.

- [ ] **Step 3: Balance chart and account page**

`src/components/charts/BalanceChart.tsx`:
```tsx
"use client";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatCents } from "@/lib/money";

export function BalanceChart({ points, currency }: { points: { date: string; balanceCents: number }[]; currency: string }) {
  if (points.length === 0) return <p className="muted text-sm">No balance history yet. Each sync records a snapshot.</p>;
  const data = points.map((p) => ({ date: p.date, balance: p.balanceCents / 100 }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
        <YAxis tick={{ fontSize: 11 }} width={64} tickFormatter={(v: number) => v.toLocaleString()} />
        <Tooltip formatter={(v) => formatCents(Math.round(Number(v) * 100), currency)} />
        <Area type="monotone" dataKey="balance" stroke="#0f766e" fill="#0f766e" fillOpacity={0.15} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

`src/app/accounts/[id]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getAccount, displayName } from "@/lib/queries/accounts";
import { accountBalanceSeries } from "@/lib/queries/balances";
import { listTransactions } from "@/lib/queries/transactions";
import { unixToDate } from "@/lib/format";
import { Amount } from "@/components/Amount";
import { BalanceChart } from "@/components/charts/BalanceChart";
import { TransactionFilters } from "@/components/TransactionFilters";
import { TransactionsTable, Pagination } from "@/components/TransactionsTable";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const account = getAccount(db, decodeURIComponent(id));
  if (!account) notFound();
  const basePath = `/accounts/${encodeURIComponent(account.id)}`;
  const filter = { accountId: account.id, q: one(sp.q), from: one(sp.from), to: one(sp.to), page: Number(one(sp.page) ?? 1) || 1, pageSize: 50, includeHidden: true };
  const { rows, total, page, pageSize } = listTransactions(db, filter);
  const series = accountBalanceSeries(db, account.id, 365);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{displayName(account)}</h1>
          <p className="muted text-sm">{account.name} · {account.type ?? "unclassified"}{account.hidden ? " · hidden" : ""} · <Link href="/settings" className="underline">edit</Link></p>
        </div>
        <div className="text-right">
          <p className="text-2xl"><Amount cents={account.balanceCents} currency={account.currency} /></p>
          <p className="muted text-xs">as of {unixToDate(account.balanceDate)}{account.availableBalanceCents !== null ? <> · available <Amount cents={account.availableBalanceCents} currency={account.currency} signColour={false} /></> : null}</p>
        </div>
      </div>
      <section className="card">
        <h2 className="mb-2 font-medium">Balance history</h2>
        <BalanceChart points={series} currency={account.currency} />
      </section>
      <TransactionFilters accounts={[]} current={filter} basePath={basePath} hideAccountSelect />
      <TransactionsTable rows={rows} showAccount={false} />
      <Pagination page={page} total={total} pageSize={pageSize} basePath={basePath} params={{ q: filter.q, from: filter.from, to: filter.to }} />
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build`, then `npm run dev`. Visit `/transactions`, apply each filter, paginate; click an account name to reach `/accounts/<id>`; visit `/accounts/does-not-exist` → 404 page.
Expected: filters preserved in the URL, hidden accounts absent from "All", chart renders with ≥1 snapshot.

- [ ] **Step 5: Commit**

```bash
git add src/app/transactions src/app/accounts src/components
git commit -m "feat(ui): transactions list with filters and account detail page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Spending page

**Files:**
- Create: `src/app/spending/page.tsx`, `src/components/charts/SpendingChart.tsx`

**Interfaces:**
- Consumes: `spendingByPeriod`, `topPayees`, `PeriodTotals`, `Granularity`.
- Produces: `<SpendingChart rows={PeriodTotals[]} currency />` (client, Recharts BarChart with outflow and inflow bars). URL params: `range` ∈ `7d|30d|90d|12m` (default `30d`), `g` ∈ `day|week|month` (default derived: 7d→day, 30d→day, 90d→week, 12m→month), `currency` (default: currency with the largest outflow).

- [ ] **Step 1: Chart component**

`src/components/charts/SpendingChart.tsx`:
```tsx
"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { formatCents } from "@/lib/money";
import type { PeriodTotals } from "@/lib/queries/spending";

export function SpendingChart({ rows, currency }: { rows: PeriodTotals[]; currency: string }) {
  if (rows.length === 0) return <p className="muted text-sm">No transactions in this range.</p>;
  const data = rows.map((r) => ({ period: r.period, outflow: r.outflowCents / 100, inflow: r.inflowCents / 100 }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey="period" tick={{ fontSize: 11 }} minTickGap={16} />
        <YAxis tick={{ fontSize: 11 }} width={64} tickFormatter={(v: number) => v.toLocaleString()} />
        <Tooltip formatter={(v, name) => [formatCents(Math.round(Number(v) * 100), currency), String(name)]} />
        <Legend />
        <Bar dataKey="outflow" name="Spent" fill="#b91c1c" radius={[3, 3, 0, 0]} />
        <Bar dataKey="inflow" name="Received" fill="#15803d" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Spending page**

`src/app/spending/page.tsx`:
```tsx
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { spendingByPeriod, topPayees, type Granularity } from "@/lib/queries/spending";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { SpendingChart } from "@/components/charts/SpendingChart";

export const dynamic = "force-dynamic";

const RANGES = { "7d": { days: 7, g: "day" }, "30d": { days: 30, g: "day" }, "90d": { days: 90, g: "week" }, "12m": { days: 365, g: "month" } } as const;
type RangeKey = keyof typeof RANGES;
const GRANULARITIES: Granularity[] = ["day", "week", "month"];

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function SpendingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const rangeKey = ((one(sp.range) ?? "30d") in RANGES ? one(sp.range) ?? "30d" : "30d") as RangeKey;
  const range = RANGES[rangeKey];
  const gParam = one(sp.g) as Granularity | undefined;
  const granularity: Granularity = gParam && GRANULARITIES.includes(gParam) ? gParam : range.g;
  const db = getDb();
  const all = spendingByPeriod(db, { days: range.days, granularity });
  const currencies = [...new Set(all.map((r) => r.currency))];
  const outflowByCurrency = new Map<string, number>();
  for (const r of all) outflowByCurrency.set(r.currency, (outflowByCurrency.get(r.currency) ?? 0) + r.outflowCents);
  const defaultCurrency = [...outflowByCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const currency = one(sp.currency) && currencies.includes(one(sp.currency)!) ? one(sp.currency)! : defaultCurrency;
  const rows = all.filter((r) => r.currency === currency);
  const totalOut = rows.reduce((n, r) => n + r.outflowCents, 0);
  const totalIn = rows.reduce((n, r) => n + r.inflowCents, 0);
  const payees = topPayees(db, { days: range.days, limit: 10 }).filter((p) => p.currency === currency);

  const link = (patch: Partial<{ range: string; g: string; currency: string }>) => {
    const q = new URLSearchParams({ range: rangeKey, g: granularity, ...(currency ? { currency } : {}), ...patch });
    return `/spending?${q.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Spending</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          {(Object.keys(RANGES) as RangeKey[]).map((k) => <Link key={k} href={link({ range: k, g: RANGES[k].g })} className={`btn ${k === rangeKey ? "btn-primary" : ""}`}>{k}</Link>)}
          <span className="muted self-center">·</span>
          {GRANULARITIES.map((g) => <Link key={g} href={link({ g })} className={`btn ${g === granularity ? "btn-primary" : ""}`}>{g}</Link>)}
          {currencies.length > 1 ? (<><span className="muted self-center">·</span>{currencies.map((c) => <Link key={c} href={link({ currency: c })} className={`btn ${c === currency ? "btn-primary" : ""}`}>{c}</Link>)}</>) : null}
        </div>
      </div>

      {!currency ? (
        <EmptyState title="No transactions in this range">Sync first, or widen the range.</EmptyState>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <div className="card"><p className="muted text-xs uppercase tracking-wide">Spent</p><p className="mt-1 text-2xl font-semibold"><Amount cents={-totalOut} currency={currency} /></p></div>
            <div className="card"><p className="muted text-xs uppercase tracking-wide">Received</p><p className="mt-1 text-2xl font-semibold"><Amount cents={totalIn} currency={currency} /></p></div>
            <div className="card"><p className="muted text-xs uppercase tracking-wide">Net</p><p className="mt-1 text-2xl font-semibold"><Amount cents={totalIn - totalOut} currency={currency} /></p></div>
          </section>
          <section className="card">
            <h2 className="mb-2 font-medium">By {granularity}</h2>
            <SpendingChart rows={rows} currency={currency} />
          </section>
          <section className="card">
            <h2 className="mb-2 font-medium">Top payees</h2>
            <table className="data">
              <thead><tr><th>Payee</th><th className="num">Transactions</th><th className="num">Spent</th></tr></thead>
              <tbody>{payees.map((p) => <tr key={p.label}><td>{p.label}</td><td className="num">{p.count}</td><td className="num"><Amount cents={-p.outflowCents} currency={currency} /></td></tr>)}</tbody>
            </table>
          </section>
          <p className="muted text-xs">Transfers between your own accounts and credit-card payments are counted as spending for now. Transfer detection and categories arrive in phase 2. Hidden accounts are excluded.</p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build && npm run dev`. Visit `/spending`, switch ranges, granularities, and currencies (if more than one). Expected: totals match the chart sums; the footer note is visible.

- [ ] **Step 4: Commit**

```bash
git add src/app/spending src/components/charts/SpendingChart.tsx
git commit -m "feat(ui): spending breakdown by period with top payees

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Raw data explorer

**Files:**
- Create: `src/app/explorer/page.tsx`, `src/app/explorer/[runId]/page.tsx`, `src/components/JsonView.tsx`

**Interfaces:**
- Consumes: `listSyncRuns`, `getSyncRun`, `getSyncStatus`, `parseAccountSet` (to split the raw body per account for display), `ErrItem`.
- Produces: `<JsonView value={unknown} />` renders `<pre class="json">` with 2-space JSON.

- [ ] **Step 1: JsonView**

`src/components/JsonView.tsx`:
```tsx
export function JsonView({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
```

- [ ] **Step 2: Runs list**

`src/app/explorer/page.tsx`:
```tsx
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listSyncRuns, getSyncStatus } from "@/lib/queries/syncRuns";
import { isoToLocal, unixToDate } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { SyncButton } from "@/components/SyncButton";
import type { ErrItem } from "@/lib/simplefin/types";

export const dynamic = "force-dynamic";

export default function ExplorerPage() {
  const db = getDb();
  const runs = listSyncRuns(db, 100);
  const status = getSyncStatus(db);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Explorer</h1>
          <p className="muted text-sm">Every SimpleFin request fineants has made, with the raw response. Last successful window ended {status.lastSuccessfulSyncEnd ? unixToDate(status.lastSuccessfulSyncEnd) : "never"}.</p>
        </div>
        <SyncButton />
      </div>
      {runs.length === 0 ? (
        <EmptyState title="No sync runs yet">Click Sync now, or run <code>npm run sync</code>.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>#</th><th>Started</th><th>Trigger</th><th>Status</th><th>Window</th><th className="num">Accounts</th><th className="num">Tx upserted</th><th className="num">Pending removed</th><th>Errors</th></tr></thead>
            <tbody>
              {runs.map((r) => {
                const errs = JSON.parse(r.errlist) as ErrItem[];
                return (
                  <tr key={r.id}>
                    <td><Link href={`/explorer/${r.id}`} className="underline">{r.id}</Link></td>
                    <td className="whitespace-nowrap">{isoToLocal(r.startedAt)}</td>
                    <td>{r.trigger}</td>
                    <td className={r.status === "failed" ? "neg" : r.status === "partial" ? "" : "pos"}>{r.status}</td>
                    <td className="whitespace-nowrap">{unixToDate(r.windowStart)} → {unixToDate(r.windowEnd)}</td>
                    <td className="num">{r.accountsSeen}</td>
                    <td className="num">{r.transactionsUpserted}</td>
                    <td className="num">{r.pendingRemoved}</td>
                    <td className="max-w-xs truncate" title={[r.error, ...errs.map((e) => `${e.code}: ${e.msg}`)].filter(Boolean).join("\n")}>{r.error ?? errs.map((e) => e.code).join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run detail**

`src/app/explorer/[runId]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getSyncRun } from "@/lib/queries/syncRuns";
import { isoToLocal, unixToDate } from "@/lib/format";
import { JsonView } from "@/components/JsonView";
import type { ErrItem } from "@/lib/simplefin/types";

export const dynamic = "force-dynamic";

type RawAccount = { id?: string; name?: string; transactions?: unknown[] } & Record<string, unknown>;

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const id = Number(runId);
  if (!Number.isInteger(id)) notFound();
  const run = getSyncRun(getDb(), id);
  if (!run) notFound();
  const errs = JSON.parse(run.errlist) as ErrItem[];

  let parsed: Record<string, unknown> | null = null;
  let accounts: RawAccount[] = [];
  if (run.rawResponse) {
    try {
      parsed = JSON.parse(run.rawResponse) as Record<string, unknown>;
      accounts = Array.isArray(parsed.accounts) ? (parsed.accounts as RawAccount[]) : [];
    } catch {
      parsed = null;
    }
  }
  const topLevel = parsed ? Object.fromEntries(Object.entries(parsed).filter(([k]) => k !== "accounts")) : null;

  return (
    <div className="space-y-4">
      <p className="text-sm"><Link href="/explorer" className="underline">← All runs</Link></p>
      <h1 className="text-2xl font-semibold">Sync run #{run.id}</h1>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <dt className="muted">Status</dt><dd>{run.status}</dd>
        <dt className="muted">Trigger</dt><dd>{run.trigger}</dd>
        <dt className="muted">Started</dt><dd>{isoToLocal(run.startedAt)}</dd>
        <dt className="muted">Finished</dt><dd>{isoToLocal(run.finishedAt)}</dd>
        <dt className="muted">Window</dt><dd>{unixToDate(run.windowStart)} → {unixToDate(run.windowEnd)}</dd>
        <dt className="muted">HTTP</dt><dd>{run.httpStatus ?? "—"}</dd>
        <dt className="muted">Accounts</dt><dd>{run.accountsSeen}</dd>
        <dt className="muted">Transactions</dt><dd>{run.transactionsUpserted} upserted, {run.pendingRemoved} pending removed</dd>
      </dl>
      {run.error ? <div className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--neg)" }}>{run.error}</div> : null}
      {errs.length ? (
        <section className="card">
          <h2 className="mb-2 font-medium">SimpleFin errlist</h2>
          <JsonView value={errs} />
        </section>
      ) : null}
      {topLevel ? (
        <section className="card">
          <h2 className="mb-2 font-medium">Response (without accounts)</h2>
          <JsonView value={topLevel} />
        </section>
      ) : null}
      {accounts.map((a, i) => (
        <details key={String(a.id ?? i)} className="card">
          <summary className="cursor-pointer font-medium">{String(a.name ?? a.id ?? `account ${i}`)} <span className="muted text-sm">· {Array.isArray(a.transactions) ? a.transactions.length : 0} transactions</span></summary>
          <div className="mt-3 space-y-3">
            <div>
              <p className="muted mb-1 text-xs uppercase tracking-wide">Account fields</p>
              <JsonView value={Object.fromEntries(Object.entries(a).filter(([k]) => k !== "transactions"))} />
            </div>
            <details>
              <summary className="muted cursor-pointer text-sm">Transactions</summary>
              <JsonView value={a.transactions ?? []} />
            </details>
          </div>
        </details>
      ))}
      {!parsed && run.rawResponse ? (
        <section className="card">
          <h2 className="mb-2 font-medium">Raw body (not JSON)</h2>
          <pre className="json">{run.rawResponse.slice(0, 20000)}</pre>
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build && npm run dev`. Visit `/explorer` and click a run; expand an account and its transactions; visit `/explorer/999999` → 404.

- [ ] **Step 5: Commit**

```bash
git add src/app/explorer src/components/JsonView.tsx
git commit -m "feat(ui): raw data explorer for sync runs and SimpleFin responses

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Settings page with server actions

**Files:**
- Create: `src/app/settings/page.tsx`, `src/app/settings/actions.ts`

**Interfaces:**
- Consumes: `listAccounts({includeHidden:true})`, `updateAccountSettings`, `ACCOUNT_TYPES`, `loadConfig`, `getState(STATE_KEYS.schedulerMinuteOffset)`.
- Produces: server action `updateAccount(formData: FormData): Promise<void>` reading fields `id`, `nickname`, `type`, `hidden`.

- [ ] **Step 1: Server action**

`src/app/settings/actions.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/db/schema";
import { updateAccountSettings } from "@/lib/queries/accounts";

export async function updateAccount(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const typeRaw = String(formData.get("type") ?? "");
  const type = (ACCOUNT_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as AccountType) : null;
  updateAccountSettings(getDb(), id, {
    nickname: String(formData.get("nickname") ?? ""),
    type,
    hidden: formData.get("hidden") === "on",
  });
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/transactions");
  revalidatePath("/spending");
}
```

- [ ] **Step 2: Settings page**

`src/app/settings/page.tsx`:
```tsx
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/queries/accounts";
import { ACCOUNT_TYPES } from "@/lib/db/schema";
import { loadConfig } from "@/lib/config";
import { getState, STATE_KEYS } from "@/lib/db/appState";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { updateAccount } from "./actions";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const db = getDb();
  const config = loadConfig();
  const accounts = listAccounts(db, { includeHidden: true });
  const offset = getState<number>(db, STATE_KEYS.schedulerMinuteOffset);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">Sync</h2>
        <dl className="grid grid-cols-2 gap-y-1 sm:grid-cols-4">
          <dt className="muted">Access URL</dt><dd>{config.simplefinAccessUrl ? "configured" : <span className="neg">not set</span>}</dd>
          <dt className="muted">Schedule</dt><dd>{config.syncIntervalHours > 0 ? `every ${config.syncIntervalHours} h at :${String(offset ?? 0).padStart(2, "0")}` : "disabled"}</dd>
          <dt className="muted">Backfill</dt><dd>{config.backfillDays} days</dd>
          <dt className="muted">API key</dt><dd>{config.apiKey ? "configured" : <span className="neg">not set</span>}</dd>
          <dt className="muted">Database</dt><dd className="truncate" title={config.databasePath}>{config.databasePath}</dd>
        </dl>
        <p className="muted mt-2">Change these in <code>.env</code> and restart. Magic Frame and other consumers call <code>GET /api/v1/summary</code> and <code>GET /api/v1/spending?range=7d</code> with header <code>x-api-key</code>.</p>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Accounts</h2>
        {accounts.length === 0 ? (
          <EmptyState title="No accounts yet">Sync first.</EmptyState>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => (
              <form key={a.id} action={updateAccount} className="card flex flex-wrap items-end gap-3 text-sm">
                <input type="hidden" name="id" value={a.id} />
                <div className="min-w-48 grow">
                  <p className="font-medium">{a.name}</p>
                  <p className="muted text-xs">{a.currency} · <Amount cents={a.balanceCents} currency={a.currency} /> · id {a.id}</p>
                </div>
                <label className="flex flex-col gap-1"><span className="muted text-xs">Nickname</span><input name="nickname" defaultValue={a.nickname ?? ""} placeholder={a.name} /></label>
                <label className="flex flex-col gap-1"><span className="muted text-xs">Type</span>
                  <select name="type" defaultValue={a.type ?? ""}>
                    <option value="">unclassified</option>
                    {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-1"><input type="checkbox" name="hidden" defaultChecked={a.hidden} /> hidden</label>
                <button className="btn" type="submit">Save</button>
              </form>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build && npm run dev`. On `/settings`, set a nickname and type, tick hidden, Save. Expected: page re-renders with values; `/` totals exclude the hidden account; `/transactions` "All" excludes it; the nickname shows on the overview cards.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings
git commit -m "feat(ui): account settings with nickname, type, and hidden via server actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Docker packaging and README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `README.md`

**Interfaces:**
- Consumes: `output: "standalone"`, `MIGRATIONS_DIR` env read in `createDb`, `PORT`.
- Produces: `docker compose up -d --build` serves the app on port 3000 with `./data` persisted.

- [ ] **Step 1: Dockerfile**

`Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/data/fineants.db MIGRATIONS_DIR=/app/migrations
RUN groupadd -r fineants && useradd -r -g fineants -d /app fineants && mkdir -p /data && chown fineants:fineants /data
COPY --from=build --chown=fineants:fineants /app/.next/standalone ./
COPY --from=build --chown=fineants:fineants /app/.next/static ./.next/static
COPY --from=build --chown=fineants:fineants /app/public ./public
COPY --from=build --chown=fineants:fineants /app/src/lib/db/migrations ./migrations
USER fineants
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
```
If `public/` is empty after Task 12's cleanup, keep a `public/.gitkeep` so the COPY succeeds.

- [ ] **Step 2: .dockerignore and compose**

`.dockerignore`:
```
node_modules
.next
data
.env
.env.*
!.env.example
docs
.git
*.md
```

`docker-compose.yml`:
```yaml
services:
  fineants:
    build: .
    container_name: fineants
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file: .env
    environment:
      DATABASE_PATH: /data/fineants.db
    volumes:
      - ./data:/data
```
`env_file` supplies `SIMPLEFIN_ACCESS_URL`, `API_KEY`, `SYNC_INTERVAL_HOURS`, `BACKFILL_DAYS`; the `environment` block pins the in-container database path over whatever `.env` says.

- [ ] **Step 3: README**

`README.md`:
````markdown
# fineants

Personal finance dashboard fed by [SimpleFin Bridge](https://beta-bridge.simplefin.org). Syncs accounts and transactions into a local SQLite file on a schedule, shows balances, net worth, transactions and spending, and exposes a small JSON API for a Magic Frame display.

## Setup

1. `cp .env.example .env` and generate an API key: `openssl rand -hex 32`.
2. Get a **setup token** from SimpleFin Bridge, then exchange it once:
   ```bash
   npm install
   npm run claim -- <setup-token>
   ```
   Paste the printed `SIMPLEFIN_ACCESS_URL=…` line into `.env`. The setup token is dead after this; the access URL is the credential. Keep it private.
3. First sync (about 5 requests for a year of history):
   ```bash
   npm run sync
   ```
4. Run the app: `npm run dev` and open http://localhost:3000.

## Docker (home server)

```bash
docker compose up -d --build
```
Data lives in `./data/fineants.db`. Back that file up. The scheduler runs inside the container every `SYNC_INTERVAL_HOURS` at a fixed random minute.

## API

All routes need header `x-api-key: $API_KEY`.

- `POST /api/sync[?force=1]` — run a sync now (409 if one ran under 30 minutes ago, 503 if credentials are invalid or missing).
- `GET /api/v1/summary` — balances per account and per currency, last sync status. Amounts are integer cents.
- `GET /api/v1/spending?range=today|7d|30d` — daily outflow/inflow and top payees.

## Scripts

| command | purpose |
| --- | --- |
| `npm run claim -- <token>` | exchange a setup token for an access URL |
| `npm run sync [-- --force]` | sync from the CLI |
| `npm run db:generate` | create a migration after editing `src/lib/db/schema.ts` |
| `npm test` | Vitest (no network) |

## Notes

- SimpleFin limits each request to 90 days and asks for ≤24 requests/day. fineants overlaps windows by 5 days and refuses to sync twice within 30 minutes unless forced.
- Transfers between your own accounts count as spending until phase 2 adds transfer detection.
- The dashboard has no login; keep it on your LAN or behind your own reverse-proxy auth.
````

- [ ] **Step 4: Build and run the container**

Run:
```bash
npm test && npm run lint
docker compose build
docker compose up -d
sleep 5
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/            # 200
curl -s -H "x-api-key: $(grep ^API_KEY= .env | cut -d= -f2)" localhost:3000/api/v1/summary | head -c 200; echo
docker compose logs --tail 20 fineants                             # shows "[fineants scheduler] started; interval 6h at :NN"
ls -la data/                                                       # fineants.db present
docker compose down
```
Expected: 200, JSON, scheduler log line, database file owned by the container user.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml README.md public/.gitkeep
git commit -m "chore: docker packaging and README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Plan self-review

**Spec coverage.** §5 data model → Task 4. §6 client → Tasks 5–6. §7 engine → Task 8. §8 scheduler → Task 9. §9 config → Tasks 1, 3. §10 UI: overview (12), transactions and account detail (13), spending (14), explorer (15), settings (16); empty states in each. §11 API → Task 11. §12 testing → each task carries its tests; UI verified manually as the spec confines Vitest to lib and API. §13 packaging → Task 17. §14 error handling → Tasks 8 (flags, failed runs, raw body kept), 12 (banner), 9 (scheduler try/catch). Phase 2 tables are intentionally not created.

**Type consistency.** `SyncStatus`, `TxRow`, `TxFilter`, `PeriodTotals`, `SeriesPoint`, `CredentialsInvalidState`, `ErrItem`, `AccountType` are defined once (Tasks 4, 5, 8, 10) and imported by the same names in 11–16. `runSync(deps, opts)` signature is identical in Tasks 8, 9, 11. `displayName` is used by 11, 12, 13, and the SQL equivalent in `listTransactions` mirrors it.

**Known judgment calls for the executor.** zod 4 method chaining in Task 3 may need `.superRefine`; the `URL.username = ""` approach in Task 6 has a documented fallback; SQLite `%G-W%V` needs ≥3.46 (Task 10). Each is called out inline with the alternative.
