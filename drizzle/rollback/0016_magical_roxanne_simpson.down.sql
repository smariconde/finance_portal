-- Manual rollback for 0016_magical_roxanne_simpson.sql.
-- Run only against the intended database after verifying backups and dependants.
-- PostgreSQL cannot drop a value from an enum, so undoing the refresh job kind
-- means rebuilding the type. The script refuses while any job carries that kind:
-- rewriting it to the backfill kind would make a refresh job look like a plan it
-- never was, and dropping it would erase an audited plan (TM-16). Cancel and
-- delete those jobs deliberately first, or keep the value — an unused enum value
-- costs nothing.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ingestion_jobs" WHERE "job_kind" = 'sec_companyfacts_refresh'
  ) THEN
    RAISE EXCEPTION 'a refresh job exists; remove it deliberately before rolling back 0016';
  END IF;
END
$$;
ALTER TABLE "ingestion_jobs" ALTER COLUMN "job_kind" TYPE text;
DROP TYPE "public"."ingestion_job_kind";
CREATE TYPE "public"."ingestion_job_kind" AS ENUM('sec_companyfacts_backfill');
ALTER TABLE "ingestion_jobs"
  ALTER COLUMN "job_kind" TYPE "public"."ingestion_job_kind"
  USING "job_kind"::"public"."ingestion_job_kind";
COMMIT;
