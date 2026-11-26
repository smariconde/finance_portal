-- Manual rollback for drizzle-trading/0008_trading_books.sql.
-- It drops the owner's day/swing split, the day risk per trade and the book of
-- every pre-market idea revision. Revisions keep their other values: rules
-- read as trading-rules-1.0.0 plus the declared defaults, ideas read as swing.
-- Export trading_risk_settings and pre_market_ideas first.
ALTER TABLE "trading_risk_settings" DROP CONSTRAINT IF EXISTS "trading_risk_settings_books_check";--> statement-breakpoint
ALTER TABLE "pre_market_ideas" DROP CONSTRAINT IF EXISTS "pre_market_ideas_book_check";--> statement-breakpoint
ALTER TABLE "trading_risk_settings" DROP COLUMN IF EXISTS "day_risk_per_trade_percent";--> statement-breakpoint
ALTER TABLE "trading_risk_settings" DROP COLUMN IF EXISTS "swing_allocation_percent";--> statement-breakpoint
ALTER TABLE "pre_market_ideas" DROP COLUMN IF EXISTS "book";
--
-- To re-apply 0008 afterwards, delete its row from drizzle.__drizzle_migrations
-- (created_at = 1795650186369).
