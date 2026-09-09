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
