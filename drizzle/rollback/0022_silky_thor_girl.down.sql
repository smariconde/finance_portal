-- Manual rollback for 0022_silky_thor_girl.sql.
-- Run only against the intended database after verifying backups and dependants.
-- PostgreSQL cannot drop a value from an enum, so undoing the price refresh job
-- kind means rebuilding the type. The script refuses while any job carries that
-- kind: rewriting it to another kind would make a price job look like a plan it
-- never was, and dropping it would erase an audited plan (TM-16). Cancel and
-- delete those jobs deliberately first, or keep the value — an unused enum value
-- costs nothing.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ingestion_jobs" WHERE "job_kind" = 'yahoo_prices_refresh'
  ) THEN
    RAISE EXCEPTION 'a price refresh job exists; remove it deliberately before rolling back 0022';
  END IF;
END
$$;
ALTER TABLE "ingestion_jobs" ALTER COLUMN "job_kind" TYPE text;
DROP TYPE "public"."ingestion_job_kind";
CREATE TYPE "public"."ingestion_job_kind" AS ENUM('sec_companyfacts_backfill', 'sec_companyfacts_refresh');
ALTER TABLE "ingestion_jobs"
  ALTER COLUMN "job_kind" TYPE "public"."ingestion_job_kind"
  USING "job_kind"::"public"."ingestion_job_kind";
COMMIT;
