CREATE TABLE `users` (
	`wallet_address` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `app_deployments` ADD `owner_wallet` text REFERENCES users(wallet_address);--> statement-breakpoint
ALTER TABLE `app_deployments` ADD `token_name` text;--> statement-breakpoint
ALTER TABLE `app_deployments` ADD `token_symbol` text;--> statement-breakpoint
ALTER TABLE `app_deployments` ADD `token_mint` text;
