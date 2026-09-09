CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`available_balance_cents` integer,
	`balance_date` integer NOT NULL,
	`raw` text NOT NULL,
	`nickname` text,
	`type` text,
	`hidden` integer DEFAULT false NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`sync_run_id` integer NOT NULL,
	`balance_cents` integer NOT NULL,
	`available_balance_cents` integer,
	`balance_date` integer NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `balance_snapshots_account_recorded_idx` ON `balance_snapshots` (`account_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`url` text,
	`sfin_url` text,
	`raw` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`http_status` integer,
	`accounts_seen` integer DEFAULT 0 NOT NULL,
	`transactions_upserted` integer DEFAULT 0 NOT NULL,
	`pending_removed` integer DEFAULT 0 NOT NULL,
	`errlist` text DEFAULT '[]' NOT NULL,
	`error` text,
	`raw_response` text
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`posted` integer NOT NULL,
	`transacted_at` integer,
	`amount_cents` integer NOT NULL,
	`description` text NOT NULL,
	`payee` text,
	`memo` text,
	`pending` integer DEFAULT false NOT NULL,
	`raw` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transactions_account_posted_idx` ON `transactions` (`account_id`,`posted`);--> statement-breakpoint
CREATE INDEX `transactions_posted_idx` ON `transactions` (`posted`);--> statement-breakpoint
CREATE INDEX `transactions_pending_idx` ON `transactions` (`pending`);