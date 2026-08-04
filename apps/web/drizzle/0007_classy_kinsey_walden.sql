CREATE TABLE `artwork_hashes` (
	`illustration_id` text PRIMARY KEY NOT NULL,
	`art_phash` blob NOT NULL,
	`full_phash` blob,
	`source_card_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `cards` ADD `illustration_id` text;--> statement-breakpoint
CREATE INDEX `cards_illustration_id_idx` ON `cards` (`illustration_id`);