-- Manual rollback for drizzle-trading/0001_schwab_connection.sql.
-- Run only after deliberately deciding to drop the Schwab connection: the
-- encrypted tokens go with it, so the owner has to log in to Schwab again, and
-- the connection log (TM-16) and the Schwab sources' daily usage and kill
-- switch history are lost. Export schwab_connection_events and source_controls
-- first if the incident being rolled back must stay explainable.
DROP TABLE "schwab_connection_events";
DROP TABLE "schwab_connections";
DROP TABLE "schwab_oauth_states";
DROP TABLE "source_controls";
DROP TABLE "source_budgets";
DROP TYPE "schwab_connection_event_kind";
DROP TYPE "source_status";
--
-- To re-apply 0001 afterwards, delete its row from drizzle.__drizzle_migrations
-- (created_at = 1794605813924).
