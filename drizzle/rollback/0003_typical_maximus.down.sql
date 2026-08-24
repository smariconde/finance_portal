-- Manual rollback for 0003_typical_maximus.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping valuation_runs discards every recorded valuation, including the
-- rejected ones that explain why a value was never produced; export it first if
-- the incident being rolled back needs to stay explainable (TM-16).
-- The input snapshots stored here are the only record of which assumptions and
-- which knowledge cutoff produced a published number: losing them makes a past
-- result unreproducible even though the engine is deterministic.
BEGIN;
DROP TABLE IF EXISTS "valuation_runs";
DROP TYPE IF EXISTS "valuation_failure_code";
DROP TYPE IF EXISTS "valuation_run_status";
COMMIT;
