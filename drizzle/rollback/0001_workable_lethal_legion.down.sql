-- Manual rollback for 0001_workable_lethal_legion.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping ingestion_runs discards the audit trail of every run; export it first
-- if the incident being rolled back needs to stay explainable (TM-16).
BEGIN;
DROP TABLE IF EXISTS "ingestion_runs";
DROP TABLE IF EXISTS "source_registry";
DROP TYPE IF EXISTS "ingestion_failure_code";
DROP TYPE IF EXISTS "ingestion_run_status";
DROP TYPE IF EXISTS "source_approval_status";
DROP TYPE IF EXISTS "source_authentication";
DROP TYPE IF EXISTS "source_rights_decision";
DROP TYPE IF EXISTS "source_technical_status";
COMMIT;
