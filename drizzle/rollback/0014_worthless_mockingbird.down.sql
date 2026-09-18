-- Manual rollback for 0014_worthless_mockingbird.sql.
-- Run only against the intended database after verifying backups and dependants.
-- Dropping these two tables removes the per-source daily budget and the kill
-- switch (ADR 0020). Afterwards every request budget is per process again: two
-- commands in a row get a full quota each, and there is no way to stop a source
-- without editing code. Both are TM-10 controls, so this is a deliberate
-- downgrade, not a cleanup.
-- The script refuses while a source is disabled: rolling that back would silently
-- re-enable a source the owner stopped on purpose. Re-enable it first, on the
-- record, and then roll back (TM-16).
-- Spent daily usage is discarded with the table; it is a counter, not history that
-- anything else references.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ingestion_source_controls"
    WHERE "superseded_at" IS NULL AND "status" = 'disabled'
  ) THEN
    RAISE EXCEPTION 'a source is disabled; re-enable it with a reason before rolling back 0014';
  END IF;
END
$$;
DROP TABLE IF EXISTS "ingestion_source_controls";
DROP TABLE IF EXISTS "ingestion_source_budgets";
DROP TYPE IF EXISTS "public"."ingestion_source_status";
COMMIT;
