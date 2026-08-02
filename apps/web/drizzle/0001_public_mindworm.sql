PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`oracle_id` text,
	`name` text NOT NULL,
	`layout` text NOT NULL,
	`mana_cost` text,
	`cmc` real NOT NULL,
	`type_line` text NOT NULL,
	`oracle_text` text,
	`colors` text,
	`color_identity` text NOT NULL,
	`keywords` text NOT NULL,
	`legalities` text NOT NULL,
	`games` text NOT NULL,
	`reserved` integer NOT NULL,
	`set_code` text NOT NULL,
	`set_name` text NOT NULL,
	`set_type` text NOT NULL,
	`collector_number` text NOT NULL,
	`rarity` text NOT NULL,
	`released_at` text NOT NULL,
	`artist` text,
	`border_color` text NOT NULL,
	`frame` text NOT NULL,
	`full_art` integer NOT NULL,
	`textless` integer NOT NULL,
	`promo` integer NOT NULL,
	`variation` integer NOT NULL,
	`finishes` text NOT NULL,
	`card_faces` text,
	`image_uris` text,
	`scryfall_uri` text NOT NULL,
	`prices` text NOT NULL,
	`art_phash` blob,
	`full_phash` blob,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_cards`("id", "oracle_id", "name", "layout", "mana_cost", "cmc", "type_line", "oracle_text", "colors", "color_identity", "keywords", "legalities", "games", "reserved", "set_code", "set_name", "set_type", "collector_number", "rarity", "released_at", "artist", "border_color", "frame", "full_art", "textless", "promo", "variation", "finishes", "card_faces", "image_uris", "scryfall_uri", "prices", "art_phash", "full_phash", "created_at", "updated_at") SELECT "id", "oracle_id", "name", "layout", "mana_cost", "cmc", "type_line", "oracle_text", "colors", "color_identity", "keywords", "legalities", "games", "reserved", "set_code", "set_name", "set_type", "collector_number", "rarity", "released_at", "artist", "border_color", "frame", "full_art", "textless", "promo", "variation", "finishes", "card_faces", "image_uris", "scryfall_uri", "prices", "art_phash", "full_phash", "created_at", "updated_at" FROM `cards`;--> statement-breakpoint
DROP TABLE `cards`;--> statement-breakpoint
ALTER TABLE `__new_cards` RENAME TO `cards`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cards_oracle_id_idx` ON `cards` (`oracle_id`);--> statement-breakpoint
CREATE INDEX `cards_name_idx` ON `cards` (`name`);--> statement-breakpoint
CREATE INDEX `cards_set_collector_idx` ON `cards` (`set_code`,`collector_number`);