-- Manual rollback for drizzle-trading/0005_trading_risk_settings.sql.
-- Run only after deliberately deciding to drop the owner's own risk rules:
-- every revision of the planner percentages and the daily limits is typed by
-- the owner and cannot be downloaded again. Without a row the portal falls back
-- to the declared defaults of trading-rules-1.0.0. Export
-- trading_risk_settings first.
DROP TABLE "trading_risk_settings";
--
-- To re-apply 0005 afterwards, delete its row from drizzle.__drizzle_migrations
-- (created_at = 1794762335794).
