-- Manual rollback for 0010_smooth_sally_floyd.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping the job tables discards every backfill plan, its cursor, the per-item
-- attempts and the append-only event log that explains who held a source lease,
-- which attempts were recovered and which manual recoveries the owner made.
-- Ingestion runs and observations are NOT touched: items reference runs, never
-- the other way around, so published data stays explainable by its own run.
-- The script refuses to run while a job is open or paused, or while any source
-- lease exists: that is work in progress that would vanish without a trace.
-- Cancel or finish those jobs and release the leases first, on purpose, and
-- export ingestion_job_events if the incident needs to stay explainable (TM-16).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ingestion_jobs" WHERE "status" IN ('open', 'paused')) THEN
    RAISE EXCEPTION 'ingestion_jobs has open or paused jobs; cancel or finish them before rolling back 0010';
  END IF;
  IF EXISTS (SELECT 1 FROM "ingestion_source_leases") THEN
    RAISE EXCEPTION 'ingestion_source_leases is not empty; release the leases before rolling back 0010';
  END IF;
END
$$;
DROP TABLE IF EXISTS "ingestion_job_events";
DROP TABLE IF EXISTS "ingestion_source_leases";
DROP TABLE IF EXISTS "ingestion_job_items";
DROP TABLE IF EXISTS "ingestion_jobs";
DROP TYPE IF EXISTS "ingestion_job_event_type";
DROP TYPE IF EXISTS "ingestion_job_failure_code";
DROP TYPE IF EXISTS "ingestion_job_item_status";
DROP TYPE IF EXISTS "ingestion_job_status";
DROP TYPE IF EXISTS "ingestion_job_kind";
COMMIT;
