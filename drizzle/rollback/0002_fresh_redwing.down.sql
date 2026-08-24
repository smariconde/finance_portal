-- Manual rollback for 0002_fresh_redwing.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping observations discards every published point-in-time revision and its
-- lineage to the run that produced it; export it first if the incident being
-- rolled back needs to stay explainable (TM-06, TM-16).
-- Dropping requested_vintage collapses two different runs of the same as_of into
-- the same idempotency story: re-check ingestion_runs before reingesting.
BEGIN;
DROP TABLE IF EXISTS "observations";
DROP TYPE IF EXISTS "observation_value_basis";
DROP TYPE IF EXISTS "observation_period_type";
DROP TYPE IF EXISTS "observation_subject_type";
DROP TYPE IF EXISTS "raw_value_status";
ALTER TABLE "ingestion_runs" DROP COLUMN IF EXISTS "requested_vintage";
COMMIT;
