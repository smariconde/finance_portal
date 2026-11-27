-- Manual rollback. The captured calendar revisions cannot be rebuilt later.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ingestion_jobs" WHERE "job_kind" = 'market_calendar_refresh'
  ) THEN
    RAISE EXCEPTION 'a market calendar refresh job exists; resolve its records deliberately before rolling back 0059';
  END IF;
END
$$;
DROP TABLE "calendar_event_revisions";
ALTER TABLE "ingestion_jobs" ALTER COLUMN "job_kind" TYPE text;
DROP TYPE "public"."ingestion_job_kind";
CREATE TYPE "public"."ingestion_job_kind" AS ENUM ('sec_companyfacts_backfill', 'sec_companyfacts_refresh', 'yahoo_prices_refresh', 'argentina_data_refresh', 'alpha_vantage_consensus_refresh');
ALTER TABLE "ingestion_jobs" ALTER COLUMN "job_kind" TYPE "public"."ingestion_job_kind" USING "job_kind"::"public"."ingestion_job_kind";
COMMIT;
