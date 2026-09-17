-- Manual rollback for 0011_lush_plazm.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping selection_anchor_on discards the anchor of every run whose selection
-- depends on the downloaded document (sec-core-concepts-2.0.0, ADR 0017). Without
-- it such a run no longer says which periods it went to fetch, and a missing
-- period becomes ambiguous between "the filer did not report it" and "the run did
-- not look for it".
-- Observations are NOT touched: they keep pointing at their run.
-- The script refuses while any anchor is recorded. To roll back anyway, export
-- run_id, selection_version and selection_anchor_on first and clear the column on
-- purpose before running it (TM-16).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ingestion_runs" WHERE "selection_anchor_on" IS NOT NULL) THEN
    RAISE EXCEPTION 'ingestion_runs has anchored selections; export and clear selection_anchor_on before rolling back 0011';
  END IF;
END
$$;
ALTER TABLE "ingestion_runs" DROP CONSTRAINT IF EXISTS "ingestion_runs_selection_anchor_check";
ALTER TABLE "ingestion_runs" DROP COLUMN IF EXISTS "selection_anchor_on";
COMMIT;
