-- Manual rollback for 0055_consensus_estimates.sql (ADR 0083).
-- Run only against the intended database after verifying backups and dependants.
-- Dropping the tables erases the captured consensus and the owner's declared
-- thresholds: the source dates nothing, so captures cannot be downloaded again
-- for a past day. The job kind needs the type rebuilt (PostgreSQL cannot drop
-- an enum value); the script refuses while any job carries it.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ingestion_jobs" WHERE "job_kind" = 'alpha_vantage_consensus_refresh'
  ) THEN
    RAISE EXCEPTION 'a consensus refresh job exists; remove it deliberately before rolling back 0055';
  END IF;
END
$$;
DROP TABLE "owner_multiple_thresholds";
DROP TABLE "consensus_estimates";
ALTER TABLE "ingestion_jobs" ALTER COLUMN "job_kind" TYPE text;
DROP TYPE "public"."ingestion_job_kind";
CREATE TYPE "public"."ingestion_job_kind" AS ENUM('sec_companyfacts_backfill', 'sec_companyfacts_refresh', 'yahoo_prices_refresh', 'argentina_data_refresh');
ALTER TABLE "ingestion_jobs"
  ALTER COLUMN "job_kind" TYPE "public"."ingestion_job_kind"
  USING "job_kind"::"public"."ingestion_job_kind";
COMMIT;
