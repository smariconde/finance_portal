-- Lighter observation rows (ADR 0018). Every dropped value must be rebuildable
-- from what stays, so the migration refuses before touching anything if a row
-- would lose information:
-- - external_id must equal the SEC formula over the row and its run's subject_key
--   (secFactExternalId);
-- - source_id, dataset_id and parser_version must equal the run's;
-- - quality_flags must equal its source flags plus late_ingestion, last, exactly
--   when recorded_at is more than a day after available_at.
-- A disposable database with synthetic rows (the integration database) that
-- refuses can be emptied instead.
DO $$
DECLARE
  unrebuildable_external_id bigint;
  foreign_provenance bigint;
  stored_late_flag bigint;
BEGIN
  SELECT
    count(*) FILTER (WHERE o."external_id" IS DISTINCT FROM (
      r."subject_key" || ':' || o."concept" || ':' ||
      CASE
        WHEN o."unit" = 'monetary' AND o."currency" ~ '^[A-Z]{3}$' THEN o."currency"
        WHEN o."unit" = 'monetary_per_share' AND o."currency" ~ '^[A-Z]{3}$' THEN o."currency" || '/shares'
        WHEN o."unit" IN ('shares', 'pure') AND o."currency" IS NULL THEN o."unit"
      END || ':' ||
      coalesce(to_char(o."period_start", 'YYYY-MM-DD'), 'instant') || ':' ||
      to_char(o."as_of", 'YYYY-MM-DD') || ':' ||
      o."source_document_id"
    )),
    count(*) FILTER (WHERE (o."source_id", o."dataset_id", o."parser_version")
      IS DISTINCT FROM (r."source_id", r."dataset_id", r."parser_version")),
    count(*) FILTER (WHERE o."quality_flags" IS DISTINCT FROM (
      (o."quality_flags" - 'late_ingestion') ||
      CASE
        WHEN o."recorded_at" - o."available_at" > interval '24 hours' THEN '["late_ingestion"]'::jsonb
        ELSE '[]'::jsonb
      END
    ))
  INTO unrebuildable_external_id, foreign_provenance, stored_late_flag
  FROM "observations" o
  JOIN "ingestion_runs" r ON r."run_id" = o."ingestion_run_id";

  IF unrebuildable_external_id + foreign_provenance + stored_late_flag > 0 THEN
    RAISE EXCEPTION 'observations cannot be made lighter without losing data: % external ids not rebuildable, % rows with provenance other than their run, % rows whose late_ingestion flag differs from the rule',
      unrebuildable_external_id, foreign_provenance, stored_late_flag;
  END IF;
END
$$;--> statement-breakpoint
DROP INDEX "observations_knowledge_idx";--> statement-breakpoint
DROP INDEX "observations_subject_idx";--> statement-breakpoint
ALTER TABLE "observations" DROP CONSTRAINT "observations_content_hash_check";--> statement-breakpoint
ALTER TABLE "observations" ALTER COLUMN "metric_id" DROP NOT NULL;--> statement-breakpoint
UPDATE "observations"
SET
  "metric_id" = nullif("metric_id", "concept"),
  "quality_flags" = "quality_flags" - 'late_ingestion'
WHERE "metric_id" = "concept" OR "quality_flags" @> '["late_ingestion"]'::jsonb;--> statement-breakpoint
ALTER TABLE "observations" DROP COLUMN "source_id";--> statement-breakpoint
ALTER TABLE "observations" DROP COLUMN "dataset_id";--> statement-breakpoint
ALTER TABLE "observations" DROP COLUMN "parser_version";--> statement-breakpoint
ALTER TABLE "observations" DROP COLUMN "external_id";--> statement-breakpoint
-- One rewrite for both hashes. It also leaves behind the dead tuples of the
-- UPDATE above, so the table ends compact.
ALTER TABLE "observations"
  ALTER COLUMN "revision_group_id" SET DATA TYPE bytea USING decode("revision_group_id", 'hex'),
  ALTER COLUMN "content_hash" SET DATA TYPE bytea USING decode("content_hash", 'hex');--> statement-breakpoint
CREATE INDEX "observations_subject_idx" ON "observations" USING btree ("subject_type","subject_id",coalesce("metric_id", "concept"));--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_metric_id_check" CHECK ("observations"."metric_id" is null or "observations"."metric_id" <> "observations"."concept");--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_derived_flags_check" CHECK (jsonb_typeof("observations"."quality_flags") = 'array' and not "observations"."quality_flags" @> '["late_ingestion"]'::jsonb);--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_content_hash_check" CHECK (octet_length("observations"."content_hash") = 32 and octet_length("observations"."revision_group_id") = 32);
