import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

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
    localDate: text("local_date"),
  },
  (t) => [
    index("transactions_account_posted_idx").on(t.accountId, t.posted),
    index("transactions_posted_idx").on(t.posted),
    index("transactions_pending_idx").on(t.pending),
    index("transactions_local_date_idx").on(t.localDate),
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

export const CATEGORY_KINDS = ["expense", "income"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export const RULE_FIELDS = ["payee", "description", "any"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export const RULE_MATCHES = ["contains", "regex"] as const;
export type RuleMatch = (typeof RULE_MATCHES)[number];
export const CADENCES = ["weekly", "biweekly", "monthly", "yearly", "custom_days"] as const;
export type Cadence = (typeof CADENCES)[number];
export const DEBT_KINDS = ["bnpl", "loan", "other"] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    kind: text("kind", { enum: CATEGORY_KINDS }).notNull(),
    monthlyCapCents: integer("monthly_cap_cents"),
    capCurrency: text("cap_currency"),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("categories_name_nocase_idx").on(sql`lower(${t.name})`)],
);

export const rules = sqliteTable(
  "rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    priority: integer("priority").notNull(),
    field: text("field", { enum: RULE_FIELDS }).notNull(),
    match: text("match", { enum: RULE_MATCHES }).notNull(),
    pattern: text("pattern").notNull(),
    accountId: text("account_id").references(() => accounts.id),
    minAmountCents: integer("min_amount_cents"),
    maxAmountCents: integer("max_amount_cents"),
    categoryId: integer("category_id").references(() => categories.id),
    markTransfer: integer("mark_transfer", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("rules_priority_idx").on(t.priority)],
);

export const recurringCosts = sqliteTable("recurring_costs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  provider: text("provider"),
  currency: text("currency").notNull(),
  amountCents: integer("amount_cents").notNull(),
  cadence: text("cadence", { enum: CADENCES }).notNull(),
  intervalDays: integer("interval_days"),
  anchorOn: text("anchor_on").notNull(),
  categoryId: integer("category_id").references(() => categories.id),
  accountId: text("account_id").references(() => accounts.id),
  matchPattern: text("match_pattern"),
  matchToleranceBps: integer("match_tolerance_bps").notNull().default(1000),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const transactionMeta = sqliteTable(
  "transaction_meta",
  {
    transactionId: text("transaction_id").primaryKey().references(() => transactions.id, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => categories.id),
    categorySource: text("category_source", { enum: ["rule", "recurring", "manual"] }),
    ruleId: integer("rule_id").references(() => rules.id, { onDelete: "set null" }),
    isTransfer: integer("is_transfer", { mode: "boolean" }).notNull().default(false),
    transferSource: text("transfer_source", { enum: ["auto", "rule", "manual"] }),
    counterpartTransactionId: text("counterpart_transaction_id").references(() => transactions.id),
    recurringCostId: integer("recurring_cost_id").references(() => recurringCosts.id, { onDelete: "set null" }),
    recurringSource: text("recurring_source", { enum: ["auto", "manual"] }),
    note: text("note"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("transaction_meta_category_idx").on(t.categoryId), index("transaction_meta_recurring_idx").on(t.recurringCostId)],
);

export const externalDebts = sqliteTable("external_debts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  lender: text("lender").notNull(),
  currency: text("currency").notNull(),
  kind: text("kind", { enum: DEBT_KINDS }).notNull(),
  principalCents: integer("principal_cents").notNull(),
  openedOn: text("opened_on").notNull(),
  interestFreeUntil: text("interest_free_until"),
  payoffDueOn: text("payoff_due_on"),
  aprBps: integer("apr_bps"),
  dueDay: integer("due_day"),
  instalmentAmountCents: integer("instalment_amount_cents"),
  cadence: text("cadence", { enum: CADENCES }),
  intervalDays: integer("interval_days"),
  firstInstalmentOn: text("first_instalment_on"),
  instalmentCount: integer("instalment_count"),
  notes: text("notes"),
  closedAt: text("closed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const debtPayments = sqliteTable(
  "debt_payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    debtId: integer("debt_id").notNull().references(() => externalDebts.id, { onDelete: "cascade" }),
    paidOn: text("paid_on").notNull(),
    amountCents: integer("amount_cents").notNull(),
    transactionId: text("transaction_id").references(() => transactions.id),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("debt_payments_debt_idx").on(t.debtId), uniqueIndex("debt_payments_transaction_idx").on(t.transactionId)],
);

export const connectionSyncState = sqliteTable("connection_sync_state", {
  connectionId: text("connection_id").primaryKey().references(() => connections.id),
  lastSuccessEnd: integer("last_success_end"),
  lastErrorCode: text("last_error_code"),
  lastErrorMsg: text("last_error_msg"),
  lastErrorAt: text("last_error_at"),
});

export type ConnectionRow = typeof connections.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type SyncRunRow = typeof syncRuns.$inferSelect;
export type BalanceSnapshotRow = typeof balanceSnapshots.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type RuleRow = typeof rules.$inferSelect;
export type TransactionMetaRow = typeof transactionMeta.$inferSelect;
export type ExternalDebtRow = typeof externalDebts.$inferSelect;
export type DebtPaymentRow = typeof debtPayments.$inferSelect;
export type RecurringCostRow = typeof recurringCosts.$inferSelect;
export type ConnectionSyncStateRow = typeof connectionSyncState.$inferSelect;
