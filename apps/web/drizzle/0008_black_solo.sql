CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`description` text NOT NULL,
	`commander_card_id` text,
	`partner_card_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`commander_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deck_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`scryfall_id` text NOT NULL,
	`board` text NOT NULL,
	`category` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scryfall_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_cards_entry_idx` ON `deck_cards` (`deck_id`,`scryfall_id`,`board`);--> statement-breakpoint
CREATE INDEX `deck_cards_deck_id_idx` ON `deck_cards` (`deck_id`);--> statement-breakpoint
CREATE INDEX `deck_cards_scryfall_id_idx` ON `deck_cards` (`scryfall_id`);--> statement-breakpoint
CREATE TABLE `deck_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`collection_item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_item_id`) REFERENCES `collection_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deck_allocations_deck_id_idx` ON `deck_allocations` (`deck_id`);--> statement-breakpoint
CREATE INDEX `deck_allocations_collection_item_id_idx` ON `deck_allocations` (`collection_item_id`);
