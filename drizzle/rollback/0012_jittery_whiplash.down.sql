-- Manual rollback for 0012_jittery_whiplash.sql.
-- Run only against the intended database after verifying backups and dependants.
-- It restores the heavy row shape (ADR 0018): hashes back to hex text, and
-- source_id, dataset_id, parser_version, external_id, metric_id and the
-- late_ingestion flag stored again on every row. Nothing is lost going back,
-- because every one of them is rebuilt from the row and its run.
-- external_id is only rebuildable for SEC companyfacts rows (secFactExternalId).
-- The script refuses while any other row exists: export those rows and remove
-- them on purpose before running it (TM-16).
-- To re-apply 0012 afterwards, delete its row from drizzle.__drizzle_migrations
-- and run the migration job again.
BEGIN;
DO $$
DECLARE
  unrebuildable bigint;
BEGIN
  SELECT count(*)
  INTO unrebuildable
  FROM "observations" o
  JOIN "ingestion_runs" r ON r."run_id" = o."ingestion_run_id"
  WHERE r."source_id" <> 'sec-edgar'
    OR r."dataset_id" <> 'sec.companyfacts'
    OR r."subject_key" IS NULL
    OR o."source_document_id" IS NULL
    OR NOT (
      (o."unit" IN ('monetary', 'monetary_per_share') AND o."currency" ~ '^[A-Z]{3}$')
      OR (o."unit" IN ('shares', 'pure') AND o."currency" IS NULL)
    );

  IF unrebuildable > 0 THEN
    RAISE EXCEPTION 'observations has % rows whose external_id cannot be rebuilt; export and remove them before rolling back 0012', unrebuildable;
  END IF;
END
$$;
ALTER TABLE "observations" DROP CONSTRAINT IF EXISTS "observations_content_hash_check";
ALTER TABLE "observations" DROP CONSTRAINT IF EXISTS "observations_derived_flags_check";
ALTER TABLE "observations" DROP CONSTRAINT IF EXISTS "observations_metric_id_check";
DROP INDEX IF EXISTS "observations_subject_idx";
ALTER TABLE "observations"
  ADD COLUMN "source_id" varchar(64),
  ADD COLUMN "dataset_id" varchar(128),
  ADD COLUMN "parser_version" varchar(32),
  ADD COLUMN "external_id" varchar(256);
UPDATE "observations" o
SET
  "source_id" = r."source_id",
  "dataset_id" = r."dataset_id",
  "parser_version" = r."parser_version",
  "external_id" = r."subject_key" || ':' || o."concept" || ':' ||
    CASE
      WHEN o."unit" = 'monetary' THEN o."currency"
      WHEN o."unit" = 'monetary_per_share' THEN o."currency" || '/shares'
      ELSE o."unit"
    END || ':' ||
    coalesce(to_char(o."period_start", 'YYYY-MM-DD'), 'instant') || ':' ||
    to_char(o."as_of", 'YYYY-MM-DD') || ':' || o."source_document_id",
  "metric_id" = coalesce(o."metric_id", o."concept"),
  "quality_flags" = o."quality_flags" ||
    CASE
      WHEN o."recorded_at" - o."available_at" > interval '24 hours' THEN '["late_ingestion"]'::jsonb
      ELSE '[]'::jsonb
    END
FROM "ingestion_runs" r
WHERE r."run_id" = o."ingestion_run_id";
ALTER TABLE "observations"
  ALTER COLUMN "source_id" SET NOT NULL,
  ALTER COLUMN "dataset_id" SET NOT NULL,
  ALTER COLUMN "parser_version" SET NOT NULL,
  ALTER COLUMN "external_id" SET NOT NULL,
  ALTER COLUMN "metric_id" SET NOT NULL,
  ALTER COLUMN "revision_group_id" SET DATA TYPE text USING encode("revision_group_id", 'hex'),
  ALTER COLUMN "content_hash" SET DATA TYPE text USING encode("content_hash", 'hex');
CREATE INDEX "observations_subject_idx" ON "observations" USING btree ("subject_type","subject_id","metric_id","as_of");
CREATE INDEX "observations_knowledge_idx" ON "observations" USING btree ("available_at","recorded_at");
ALTER TABLE "observations" ADD CONSTRAINT "observations_content_hash_check" CHECK ("observations"."content_hash" ~ '^[a-f0-9]{64}$' and "observations"."revision_group_id" ~ '^[a-f0-9]{64}$');
COMMIT;
