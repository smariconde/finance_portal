-- Manual rollback for drizzle-trading/0002_schwab_transactions.sql.
-- Run only after deliberately deciding to drop the stored Schwab transactions:
-- the revision chains and the sync log (TM-16) go with them. Everything can be
-- downloaded again from Schwab for the last years it serves, but corrections
-- and withdrawals already seen cannot. Export schwab_transactions and
-- schwab_transaction_runs first if the incident must stay explainable.
DROP TABLE "schwab_transactions";
DROP TABLE "schwab_transaction_sync";
DROP TABLE "schwab_transaction_runs";
DROP TABLE "schwab_accounts";
DROP TYPE "schwab_transaction_state";
DROP TYPE "schwab_transaction_run_status";
--
-- To re-apply 0002 afterwards, delete its row from drizzle.__drizzle_migrations
-- (created_at = 1794626148136).
