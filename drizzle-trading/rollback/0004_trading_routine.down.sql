-- Manual rollback for drizzle-trading/0004_trading_routine.sql.
-- Run only after deliberately deciding to drop the owner's session routines:
-- the checklist items and every session's checks and notes are typed by the
-- owner and cannot be downloaded again. Export routine_items and
-- session_routines first.
DROP TABLE "session_routines";
DROP TABLE "routine_items";
DROP TYPE "routine_phase";
--
-- To re-apply 0004 afterwards, delete its row from drizzle.__drizzle_migrations
-- (created_at = 1794695027037).
