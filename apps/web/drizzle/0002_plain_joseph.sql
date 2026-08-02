CREATE TABLE `collection_items` (
	`id` text PRIMARY KEY NOT NULL,
	`scryfall_id` text NOT NULL,
	`finish` text NOT NULL,
	`condition` text NOT NULL,
	`quantity` integer NOT NULL,
	`is_proxy` integer NOT NULL,
	`binder_location` text NOT NULL,
	`language` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`scryfall_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_items_stack_idx` ON `collection_items` (`scryfall_id`,`finish`,`condition`,`is_proxy`,`binder_location`,`language`);--> statement-breakpoint
CREATE INDEX `collection_items_scryfall_id_idx` ON `collection_items` (`scryfall_id`);