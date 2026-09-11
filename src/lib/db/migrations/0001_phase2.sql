CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`monthly_cap_cents` integer,
	`cap_currency` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_nocase_idx` ON `categories` (lower("name"));--> statement-breakpoint
CREATE TABLE `connection_sync_state` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`last_success_end` integer,
	`last_error_code` text,
	`last_error_msg` text,
	`last_error_at` text,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `debt_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`debt_id` integer NOT NULL,
	`paid_on` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`transaction_id` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`debt_id`) REFERENCES `external_debts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `debt_payments_debt_idx` ON `debt_payments` (`debt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `debt_payments_transaction_idx` ON `debt_payments` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `external_debts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`lender` text NOT NULL,
	`currency` text NOT NULL,
	`kind` text NOT NULL,
	`principal_cents` integer NOT NULL,
	`opened_on` text NOT NULL,
	`interest_free_until` text,
	`payoff_due_on` text,
	`apr_bps` integer,
	`due_day` integer,
	`instalment_amount_cents` integer,
	`cadence` text,
	`interval_days` integer,
	`first_instalment_on` text,
	`instalment_count` integer,
	`notes` text,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring_costs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`provider` text,
	`currency` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`cadence` text NOT NULL,
	`interval_days` integer,
	`anchor_on` text NOT NULL,
	`category_id` integer,
	`account_id` text,
	`match_pattern` text,
	`match_tolerance_bps` integer DEFAULT 1000 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`priority` integer NOT NULL,
	`field` text NOT NULL,
	`match` text NOT NULL,
	`pattern` text NOT NULL,
	`account_id` text,
	`min_amount_cents` integer,
	`max_amount_cents` integer,
	`category_id` integer,
	`mark_transfer` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rules_priority_idx` ON `rules` (`priority`);--> statement-breakpoint
CREATE TABLE `transaction_meta` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`category_id` integer,
	`category_source` text,
	`rule_id` integer,
	`is_transfer` integer DEFAULT false NOT NULL,
	`transfer_source` text,
	`counterpart_transaction_id` text,
	`recurring_cost_id` integer,
	`recurring_source` text,
	`note` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`counterpart_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurring_cost_id`) REFERENCES `recurring_costs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `transaction_meta_category_idx` ON `transaction_meta` (`category_id`);--> statement-breakpoint
CREATE INDEX `transaction_meta_recurring_idx` ON `transaction_meta` (`recurring_cost_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `local_date` text;--> statement-breakpoint
CREATE INDEX `transactions_local_date_idx` ON `transactions` (`local_date`);