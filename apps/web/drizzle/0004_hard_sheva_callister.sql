CREATE TABLE `import_batch_items` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`collection_item_id` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`collection_item_id`) REFERENCES `collection_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_batch_items_batch_id_idx` ON `import_batch_items` (`batch_id`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`file_name` text NOT NULL,
	`file_hash` text NOT NULL,
	`status` text NOT NULL,
	`total_rows` integer NOT NULL,
	`resolved_rows` integer NOT NULL,
	`unresolved_rows` integer NOT NULL,
	`superseded_by_batch_id` text,
	`error_message` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `import_batches_file_hash_idx` ON `import_batches` (`file_hash`);--> statement-breakpoint
CREATE TABLE `import_reconciliation_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`raw_row` text NOT NULL,
	`reason` text NOT NULL,
	`candidate_scryfall_ids` text,
	`resolved_at` integer,
	`dismissed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_reconciliation_rows_batch_id_idx` ON `import_reconciliation_rows` (`batch_id`);