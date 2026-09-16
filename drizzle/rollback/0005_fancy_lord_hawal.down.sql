-- Manual rollback for 0005_fancy_lord_hawal.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping source_documents discards the filing events (form, filing date,
-- acceptance instant and fiscal focus) that explain when every SEC observation
-- became knowable. The observations keep their available_at and accession, but no
-- longer the evidence behind them: export source_documents first if the incident
-- being rolled back needs to stay explainable (TM-06, TM-16).
-- Dropping subject_key and selection_version leaves SEC runs unable to say which
-- filer and which concept selection they ingested.
-- PostgreSQL cannot drop an enum value, so observation_period_type is rebuilt
-- without year_to_date. If any observation already uses it the cast fails and the
-- whole transaction rolls back: delete or export those rows first, on purpose.
BEGIN;
DROP TABLE IF EXISTS "source_documents";
DROP INDEX IF EXISTS "ingestion_runs_subject_idx";
ALTER TABLE "ingestion_runs" DROP COLUMN IF EXISTS "selection_version";
ALTER TABLE "ingestion_runs" DROP COLUMN IF EXISTS "subject_key";
ALTER TABLE "observations" DROP CONSTRAINT "observations_period_check";
ALTER TYPE "observation_period_type" RENAME TO "observation_period_type_0005";
CREATE TYPE "observation_period_type" AS ENUM('instant', 'daily', 'monthly', 'quarter', 'annual', 'ttm');
ALTER TABLE "observations" ALTER COLUMN "period_type" TYPE "observation_period_type" USING "period_type"::text::"observation_period_type";
DROP TYPE "observation_period_type_0005";
ALTER TABLE "observations" ADD CONSTRAINT "observations_period_check" CHECK (case when "observations"."period_type" = 'instant' then "observations"."period_start" is null and "observations"."period_end" is null else "observations"."period_start" is not null and "observations"."period_end" is not null and "observations"."period_start" <= "observations"."period_end" end);
COMMIT;
