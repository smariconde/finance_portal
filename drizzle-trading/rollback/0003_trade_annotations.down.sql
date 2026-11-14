-- Manual rollback for drizzle-trading/0003_trade_annotations.sql.
-- Run only after deliberately deciding to drop the journal annotations: plans,
-- setups, adherence, emotions and notes are typed by the owner and cannot be
-- downloaded again from Schwab. Export trade_annotations and trading_setups
-- first; without them every R in the journal goes back to null
-- (no_planned_stop).
DROP TABLE "trade_annotations";
DROP TABLE "trading_setups";
DROP TYPE "trade_adherence_mark";
DROP TYPE "trade_review_status";
--
-- To re-apply 0003 afterwards, delete its row from drizzle.__drizzle_migrations
-- (created_at = 1794691742245).
