CREATE TABLE `cloud_job_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_job_events_job_id_id` ON `cloud_job_events` (`job_id`,`id`);--> statement-breakpoint
CREATE TABLE `cloud_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`scope` text NOT NULL,
	`state` text NOT NULL,
	`input_json` text NOT NULL,
	`progress_json` text,
	`result_json` text,
	`error` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`data_revision` integer DEFAULT 0 NOT NULL,
	`data_change_json` text,
	`lease_owner` text,
	`lease_expires_at` integer,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_jobs_state_next_run` ON `cloud_jobs` (`state`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `idx_cloud_jobs_scope_updated` ON `cloud_jobs` (`scope`,`updated_at`);--> statement-breakpoint
CREATE TABLE `cloud_object_history` (
	`path` text NOT NULL,
	`revision` integer NOT NULL,
	`object_key` text NOT NULL,
	`byte_length` integer NOT NULL,
	`sha256` text NOT NULL,
	`transaction_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`path`, `revision`)
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_object_history_transaction` ON `cloud_object_history` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `cloud_objects` (
	`path` text PRIMARY KEY NOT NULL,
	`parent_path` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`content_type` text NOT NULL,
	`object_key` text NOT NULL,
	`byte_length` integer NOT NULL,
	`sha256` text NOT NULL,
	`schema_version` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_objects_parent_name` ON `cloud_objects` (`parent_path`,`name`);--> statement-breakpoint
CREATE INDEX `idx_cloud_objects_kind_updated` ON `cloud_objects` (`kind`,`updated_at`);--> statement-breakpoint
CREATE TABLE `cloud_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`manifest_json` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`committed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_transactions_state_created` ON `cloud_transactions` (`state`,`created_at`);