CREATE TABLE `collection_item_tags` (
	`collection_item_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`collection_item_id`, `tag`),
	FOREIGN KEY (`collection_item_id`) REFERENCES `collection_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_item_tags_tag_idx` ON `collection_item_tags` (`tag`);