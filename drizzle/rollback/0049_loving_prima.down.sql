-- Manual rollback for 0049_loving_prima.sql.
-- Run only against the intended database after verifying backups and dependants.
-- PostgreSQL cannot drop a value from an enum, so undoing the Argentina refresh
-- job kind means rebuilding the type. The script refuses while any job carries
-- that kind: rewriting it to another kind would make a refresh job look like a
-- plan it never was, and dropping it would erase an audited plan (TM-16).
-- Cancel and delete those jobs deliberately first, or keep the value — an
-- unused enum value costs nothing.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ingestion_jobs" WHERE "job_kind" = 'argentina_data_refresh'
  ) THEN
    RAISE EXCEPTION 'an Argentina refresh job exists; remove it deliberately before rolling back 0049';
  END IF;
END
$$;
ALTER TABLE "ingestion_jobs" ALTER COLUMN "job_kind" TYPE text;
DROP TYPE "public"."ingestion_job_kind";
CREATE TYPE "public"."ingestion_job_kind" AS ENUM('sec_companyfacts_backfill', 'sec_companyfacts_refresh', 'yahoo_prices_refresh');
ALTER TABLE "ingestion_jobs"
  ALTER COLUMN "job_kind" TYPE "public"."ingestion_job_kind"
  USING "job_kind"::"public"."ingestion_job_kind";
COMMIT;
